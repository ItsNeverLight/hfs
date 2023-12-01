// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, DragEvent, Fragment, useMemo, CSSProperties } from 'react'
import { Checkbox, Flex, FlexV, iconBtn } from './components'
import { basename, closeDialog, formatBytes, formatPerc, hIcon, isMobile, newDialog, prefix, selectFiles, working,
    HTTP_CONFLICT, HTTP_PAYLOAD_TOO_LARGE, formatSpeed
} from './misc'
import _ from 'lodash'
import { proxy, ref, subscribe, useSnapshot } from 'valtio'
import { alertDialog, confirmDialog, promptDialog } from './dialog'
import { reloadList } from './useFetchList'
import { apiCall, getNotification } from '@hfs/shared/api'
import { state, useSnapState } from './state'
import { Link } from 'react-router-dom'
import { t } from './i18n'
import { subscribeKey } from 'valtio/utils'

interface ToUpload { file: File, comment?: string }
export const uploadState = proxy<{
    done: number
    doneByte: number
    errors: number
    adding: ToUpload[]
    qs: { to: string, entries: ToUpload[] }[]
    paused: boolean
    uploading?: ToUpload
    progress: number // percentage
    partial: number // relative to uploading file. This is how much we have done of the current queue.
    speed: number
    eta: number
    skipExisting: boolean
}>({
    eta: 0,
    speed: 0,
    partial: 0,
    progress: 0,
    paused: false,
    qs: [],
    adding: [],
    errors: 0,
    doneByte: 0,
    done: 0,
    skipExisting: false,
})

// keep track of speed
let bytesSentTimestamp = Date.now()
let bytesSent = 0
setInterval(() => {
    const now = Date.now()
    const passed = (now - bytesSentTimestamp) / 1000
    if (passed < 3 && uploadState.speed) return
    uploadState.speed = bytesSent / passed
    bytesSent = 0 // reset counter
    bytesSentTimestamp = now

    // keep track of ETA
    const qBytes = _.sumBy(uploadState.qs, q => _.sumBy(q.entries, x => x.file.size))
    const left = (qBytes  - uploadState.partial)
    uploadState.eta = uploadState.speed && Math.round(left / uploadState.speed)
}, 5_000)

window.onbeforeunload = e => {
    if (!uploadState.qs.length) return
    e.preventDefault()
    return e.returnValue = t("Uploading") // modern browsers ignore this message
}

let reloadOnClose = false
let uploadDialogIsOpen = false
let everPaused = false

function resetCounters() {
    Object.assign(uploadState, {
        errors: 0,
        done: 0,
        doneByte: 0,
    })
}

export function showUpload() {
    if (!uploadState.qs.length)
        resetCounters()
    uploadDialogIsOpen = true
    const { close } = newDialog({
        dialogProps: { id: 'upload-dialog', style: { minHeight: '6em', minWidth: 'min(20em, 100vw - 1em)' } },
        title: t`Upload`,
        icon: () => hIcon('upload'),
        Content,
        onClose() {
            uploadDialogIsOpen = false
            if (!reloadOnClose) return
            reloadOnClose = false
            reloadList()
        }
    })

    function clear() {
        uploadState.adding.splice(0,Infinity)
    }

    function Content(){
        const { qs, paused, eta, speed, skipExisting, adding } = useSnapshot(uploadState) as Readonly<typeof uploadState>
        const { props } = useSnapState()
        const etaStr = useMemo(() => !eta ? '' : formatTime(eta*1000, 0, 2), [eta])
        const inQ = _.sumBy(qs, q => q.entries.length) - (uploadState.uploading ? 1 : 0)
        const queueStr = inQ && t('in_queue', { n: inQ }, "{n} in queue")
        const size = formatBytes(adding.reduce((a, x) => a + x.file.size, 0))

        return h(FlexV, { gap: '.5em', props: acceptDropFiles(more => uploadState.adding.push(...more.map(f => ({ file: ref(f) })))) },
            h(FlexV, { className: 'upload-toolbar' },
                !props?.can_upload ? t('no_upload_here', "No upload permission for the current folder")
                    : h(FlexV, {},
                        h(Flex, { justifyContent: 'center', flexWrap: 'wrap' },
                            h('button', {
                                className: 'upload-files',
                                onClick: () => pickFiles({ accept: normalizeAccept(props?.accept) })
                            }, t`Pick files`),
                            !isMobile() && h('button', {
                                className: 'upload-folder',
                                onClick: () => pickFiles({ folder: true })
                            }, t`Pick folder`),
                            h('button', { className: 'create-folder', onClick: createFolder }, t`Create folder`),
                            h(Checkbox, { value: skipExisting, onChange: v => uploadState.skipExisting = v }, t`Skip existing files`),
                        ),
                        !isMobile() && h(Flex, { gap: 4 }, hIcon('info'), t('upload_dd_hint', "You can upload files doing drag&drop on the files list")),
                        adding.length > 0 && h(Flex, { justifyContent: 'center', flexWrap: 'wrap' },
                            h('button', {
                                className: 'upload-send',
                                onClick() {
                                    enqueue(uploadState.adding).then()
                                    clear()
                                }
                            }, t('send_files', { n: adding.length, size }, "Send {n,plural,one{# file} other{# files}}, {size}")),
                            h('button', { onClick: clear }, t`Clear`),
                        )
                    ),
            ),
            h(FilesList, {
                entries: adding,
                actions: {
                    delete: rec => _.remove(uploadState.adding, { file: rec.file }),
                    comment: !props?.can_comment ? null
                        : (rec => inputComment(basename(rec.file.name), rec.comment)
                            .then(s => _.find(uploadState.adding, { file: rec.file })!.comment = s || undefined)),
                },
            }),
            h(UploadStatus, { margin: '.5em 0' }),
            qs.length > 0 && h('div', {},
                h(Flex, { justifyContent: 'center', borderTop: '1px dashed', padding: '.5em' },
                    [queueStr, etaStr, speed && formatSpeed(speed)].filter(Boolean).join(', '),
                    inQ > 0 && iconBtn('delete', ()=>  {
                        uploadState.qs = []
                        abortCurrentUpload()
                    }),
                    inQ > 0 && iconBtn(paused ? 'play' : 'pause', () => {
                        uploadState.paused = !uploadState.paused
                        if (!everPaused) {
                            everPaused = true
                            alertDialog("Pause applies to the queue, but current file will still be uploaded")
                        }
                    }),
                ),
                qs.map((q,idx) =>
                    h('div', { key: q.to },
                        h(Link, { to: q.to, onClick: close }, t`Destination`, ' ', decodeURI(q.to)),
                        h(FilesList, {
                            entries: Array.from(q.entries),
                            actions: {
                                delete: f => {
                                    if (f === uploadState.uploading)
                                        return abortCurrentUpload()
                                    const q = uploadState.qs[idx]
                                    _.pull(q.entries, f)
                                    if (!q.entries.length)
                                        uploadState.qs.splice(idx,1)
                                }
                            }
                        }),
                    ))
            )
        )

        function pickFiles(options: Parameters<typeof selectFiles>[1]) {
            selectFiles(list => {
                uploadState.adding.push( ...Array.from(list || []).filter(simulateBrowserAccept).map(f => ({ file: ref(f) })) )
            }, options)
        }
    }

}

function path(f: File, pre='') {
    return (prefix('', pre, '/') + (f.webkitRelativePath || f.name)).replaceAll('//','/')
}

function FilesList({ entries, actions }: { entries: Readonly<ToUpload[]>, actions: { [icon:string]: null | ((rec :ToUpload) => any) } }) {
    const { uploading, progress }  = useSnapshot(uploadState)
    return !entries.length ? null : h('table', { className: 'upload-list', width: '100%' },
        h('tbody', {},
            entries.map((e, i) => {
                const working = e === uploading
                return h(Fragment, { key: i },
                    h('tr', {},
                        h('td', { className: 'nowrap '}, ..._.map(actions, (cb, icon) => cb && iconBtn(icon, () => cb(e))) ),
                        h('td', {}, formatBytes(e.file.size)),
                        h('td', { className: working ? 'ani-working' : undefined },
                            path(e.file),
                            working && h('span', { className: 'upload-progress' }, formatPerc(progress))
                        ),
                    ),
                    e.comment && h('tr', {}, h('td', { colSpan: 3 }, h('div', { className: 'entry-comment' }, e.comment)) )
                )
            })
        )
    )
}

function formatTime(time: number, decimals=0, length=Infinity) {
    time /= 1000
    const ret = [(time % 1).toFixed(decimals).slice(1)]
    for (const [c,mod,pad] of [['s', 60, 2], ['m', 60, 2], ['h', 24], ['d', 36], ['y', 1 ]] as [string,number,number|undefined][]) {
        ret.push( _.padStart(String(time % mod | 0), pad || 0,'0') + c )
        time /= mod
        if (time < 1) break
    }
    return ret.slice(-length).reverse().join('')
}

/// Manage upload queue

subscribe(uploadState, () => {
    const [cur] = uploadState.qs
    if (!cur?.entries.length) {
        notificationChannel = '' // renew channel at each queue for improved security
        notificationSource?.close()
        return
    }
    if (cur?.entries.length && !uploadState.uploading && !uploadState.paused)
        startUpload(cur.entries[0], cur.to).then()
})

export async function enqueue(entries: ToUpload[]) {
    if (_.remove(entries, x => !simulateBrowserAccept(x.file)).length)
        await alertDialog(t('upload_file_rejected', "Some files were not accepted"), 'warning')

    entries = _.uniqBy(entries, x => path(x.file))
    if (!entries.length) return
    const to = location.pathname
    const q = _.find(uploadState.qs, { to })
    if (!q)
        return uploadState.qs.push({ to, entries: entries.map(ref) })
    const missing = _.differenceBy(entries, q.entries, x => path(x.file))
    q.entries.push(...missing.map(ref))
}

function simulateBrowserAccept(f: File) {
    const { props } = state
    if (!props?.accept) return true
    return normalizeAccept(props?.accept)!.split(/ *[|,] */).some(pattern =>
        pattern.startsWith('.') ? f.name.endsWith(pattern)
            : f.type.match(pattern.replace('.','\\.').replace('*', '.*')) // '.' for .ext and '*' for 'image/*'
    )
}

function normalizeAccept(accept?: string) {
    return accept?.replace(/\|/g, ',').replace(/ +/g, '')
}

let req: XMLHttpRequest | undefined
let overrideStatus = 0
let notificationChannel = ''
let notificationSource: EventSource | undefined
let closeLast: undefined | (() => void)

async function startUpload(toUpload: ToUpload, to: string, resume=0) {
    let resuming = false
    overrideStatus = 0
    uploadState.uploading = toUpload
    await subscribeNotifications()
    req = new XMLHttpRequest()
    req.onloadend = () => {
        if (req?.readyState !== 4) return
        const status = overrideStatus || req.status
        closeLast?.()
        if (status && status !== HTTP_CONFLICT) // 0 = user-aborted, HTTP_CONFLICT = skipped because existing
            if (status >= 400)
                error(status)
            else
                done()
        if (!resuming)
            next()
    }
    req.onerror = () => error(0)
    let lastProgress = 0
    req.upload.onprogress = (e:any) => {
        uploadState.partial = e.loaded + resume
        uploadState.progress = uploadState.partial / (e.total + resume)
        bytesSent += e.loaded - lastProgress
        lastProgress = e.loaded
    }
    req.open('POST', to + '?' + new URLSearchParams({
        notificationChannel,
        resume: String(resume),
        comment: toUpload.comment || '',
        ...uploadState.skipExisting && { skipExisting: '1' },
    }), true)
    const form = new FormData()
    form.append('file', toUpload.file.slice(resume), path(toUpload.file))
    req.send(form)

    async function subscribeNotifications() {
        if (notificationChannel) return
        notificationChannel = 'upload-' + Math.random().toString(36).slice(2)
        notificationSource = await getNotification(notificationChannel, async (name, data) => {
            const {uploading} = uploadState
            if (!uploading) return
            if (name === 'upload.resumable') {
                const size = data?.[path(uploading.file)]
                if (!size || size > toUpload.file.size) return
                const {expires} = data
                const timeout = typeof expires !== 'number' ? 0
                    : (Number(new Date(expires)) - Date.now()) / 1000
                closeLast?.()
                const cancelSub = subscribeKey(uploadState, 'partial', v =>
                    v >= size && closeLast?.() )  // dismiss dialog as soon as we pass the threshold
                const msg = t('confirm_resume', "Resume upload?") + ` (${formatPerc(size/toUpload.file.size)} = ${formatBytes(size)})`
                const dialog = confirmDialog(msg, { timeout })
                closeLast = dialog.close
                const confirmed = await dialog
                cancelSub()
                if (!confirmed) return
                if (uploading !== uploadState.uploading) return // too late
                resuming = true
                abortCurrentUpload()
                return startUpload(toUpload, to, size)
            }
            if (name === 'upload.status') {
                overrideStatus = data?.[path(uploading.file)]
                if (overrideStatus >= 400)
                    abortCurrentUpload()
                return
            }
        })
    }

    function error(status: number) {
        if (uploadState.errors++) return
        const ERRORS = {
            [HTTP_PAYLOAD_TOO_LARGE]: t`file too large`,
        }
        const specifier = (ERRORS as any)[status]
        const msg = t('failed_upload', toUpload, "Couldn't upload {name}") + prefix(': ', specifier)
        closeLast?.()
        closeLast = alertDialog(msg, 'error').close
    }

    function done() {
        uploadState.done++
        uploadState.doneByte += toUpload!.file.size
        reloadOnClose = true
    }

    function next() {
        uploadState.uploading = undefined
        uploadState.partial = 0
        const { qs } = uploadState
        if (!qs.length) return
        qs[0].entries.shift()
        if (!qs[0].entries.length)
            qs.shift()
        if (qs.length) return
        setTimeout(reloadList, 500) // workaround: reloading too quickly can meet the new file still with its temp name
        reloadOnClose = false
        if (!uploadDialogIsOpen)
            alertDialog(
                h('div', {},
                    t(['upload_concluded', "Upload terminated"], "Upload concluded:"),
                    h(UploadStatus)
                ),
                'info'
            ).finally(resetCounters)
    }
}

function UploadStatus(props: CSSProperties) {
    const { done, doneByte, errors } = useSnapshot(uploadState)
    const s = [
        done && t('upload_finished', { n: done, size: formatBytes(doneByte) }, "{n} finished ({size})"),
        errors && t('upload_errors', { n: errors }, "{n} failed")
    ].filter(Boolean).join(' – ')
    return !s ? null : h('div', { style: props }, s)
}

function abortCurrentUpload() {
    req?.abort()
}

export function acceptDropFiles(cb: false | undefined | ((files:File[]) => void)) {
    return {
        onDragOver(ev: DragEvent) {
            ev.preventDefault()
            ev.dataTransfer!.dropEffect = cb ? 'copy' : 'none'
        },
        onDrop(ev: DragEvent) {
            ev.preventDefault()
            cb && cb(Array.from(ev.dataTransfer!.files))
        },
    }
}

async function createFolder() {
    const name = await promptDialog(t`Enter folder name`)
    if (!name) return
    const uri = location.pathname
    try {
        await apiCall('create_folder', { uri, name }, { modal: working })
        reloadList()
        return alertDialog(h(() =>
            h(FlexV, {},
                h('div', {}, t`Successfully created`),
                h(Link, { to: uri + name + '/', onClick() {
                    closeDialog()
                    closeDialog()
                } }, t('enter_folder', "Enter the folder")),
            )))
    }
    catch(e: any) {
        await alertDialog(e.code === HTTP_CONFLICT ? t('folder_exists', "Folder with same name already exists") : e)
    }
}

export function inputComment(filename: string, def?: string) {
    return promptDialog(t('enter_comment', "Comment for " + filename), { def, type: 'textarea' })
}