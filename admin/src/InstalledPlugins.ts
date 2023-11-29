// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall, useApiList } from './api'
import { createElement as h, Fragment, ReactNode } from 'react'
import { Box, Link, Tooltip } from '@mui/material'
import { DataTable } from './DataTable'
import { Delete, Error as ErrorIcon, PlayCircle, Settings, StopCircle, Upgrade } from '@mui/icons-material'
import { Btn, HTTP_FAILED_DEPENDENCY, IconBtn, prefix, with_ } from './misc'
import { alertDialog, formDialog, toast } from './dialog'
import _ from 'lodash'
import { BoolField, Field, MultiSelectField, NumberField, SelectField, StringField } from '@hfs/mui-grid-form'
import { ArrayField } from './ArrayField'
import FileField from './FileField'

export default function InstalledPlugins({ updates }: { updates?: true }) {
    const { list, updateEntry, error, initializing } = useApiList(updates ? 'get_plugin_updates' : 'get_plugins')
    const size = 'small'
    return h(DataTable, {
        error,
        rows: list.length ? list : [], // workaround for DataGrid bug causing 'no rows' message to be not displayed after 'loading' was also used
        initializing,
        disableColumnSelector: true,
        disableColumnMenu: true,
        hideFooter: true,
        noRows: updates && `No updates available. Only plugins available on "search online" are checked.`,
        columns: [
            {
                field: 'id',
                headerName: "name",
                flex: .3,
                minWidth: 150,
                renderCell: renderName,
                mergeRender: { other: 'description', fontSize: 'x-small' }
            },
            {
                field: 'version',
                width: 70,
                hideUnder: 'sm',
            },
            {
                field: 'description',
                flex: 1,
                hideUnder: 'sm',
            },
        ],
        actions: ({ row, id }) => updates ? [
            h(IconBtn, {
                icon: Upgrade,
                title: row.updated ? "Already updated" : "Update",
                disabled: row.updated,
                size,
                async onClick() {
                    await apiCall('update_plugin', { id }, { timeout: false }).catch(e => {
                        throw e.code !== HTTP_FAILED_DEPENDENCY ? e
                            : Error("Failed dependencies: " + e.cause?.map((x: any) => prefix(`plugin "`, x.id || x.repo, `" `) + x.error).join('; '))
                    })
                    updateEntry({ id }, { updated: true })
                    toast("Plugin updated")
                }
            })
        ] : [
            h(IconBtn, row.started ? {
                icon: StopCircle,
                title: h(Box, {}, `Stop ${id}`, h('br'), `Started ` + new Date(row.started as string).toLocaleString()),
                size,
                color: 'success',
                async onClick() {
                    await apiCall('stop_plugin', { id })
                    toast("Plugin stopped", h(StopCircle, { color: 'warning' }))
                }
            } : {
                icon: PlayCircle,
                title: `Start ${id}`,
                size,
                onClick: () => startPlugin(id),
            }),
            h(IconBtn, {
                icon: Settings,
                title: "Options",
                size,
                disabled: !row.started && "Start plugin to access options"
                    || !row.config && "No options available for this plugin",
                progress: false,
                async onClick() {
                    const pl = await apiCall('get_plugin', { id })
                    let lastSaved = pl.config
                    const values = await formDialog({
                        title: `Options for ${id}`,
                        form: values => ({
                            before: h(Box, { mx: 2, mb: 3 }, row.description),
                            fields: makeFields(row.config),
                            save: { children: "Save and close" },
                            barSx: { gap: 1 },
                            addToBar: [h(Btn, { variant: 'outlined', onClick: () => save(values) }, "Save")],
                        }),
                        values: pl.config,
                        dialogProps: _.merge({ sx: { m: 'auto' } }, // center content when it is smaller than mobile (because of full-screen)
                            row.configDialog),
                    })
                    if (values && !_.isEqual(lastSaved, values))
                        return save(values)

                    async function save(values: any) {
                        await apiCall('set_plugin', { id, config: values })
                        Object.assign(lastSaved, values)
                        toast("Configuration saved")
                    }
                }
            }),
            h(IconBtn, {
                icon: Delete,
                title: "Uninstall",
                size,
                confirm: "Remove?",
                async onClick() {
                    await apiCall('uninstall_plugin', { id })
                    toast("Plugin uninstalled")
                }
            }),
        ]
    })
}

export function renderName({ row, value }: any) {
    const { repo } = row
    return h(Fragment, {},
        errorIcon(row.badApi, true),
        errorIcon(row.error),
        repo?.includes('//') ? h(Link, { href: repo, target: 'plugin' }, value)
            : !repo ? value
                : with_(repo?.split('/'), arr => h(Fragment, {},
                    h(Link, { href: 'https://github.com/' + repo, target: 'plugin' }, arr[1]),
                    '\xa0by ', arr[0]
                ))
    )

    function errorIcon(msg: ReactNode, warning=false) {
        return msg && h(Tooltip, {
            title: msg,
            children: h(ErrorIcon, { fontSize: 'small', color: warning ? 'warning' : 'error', sx: { ml: -.5, mr: .5 } })
        })
    }
}

function makeFields(config: any) {
    return Object.entries(config).map(([k,o]: [string,any]) => {
        if (!_.isPlainObject(o))
            return o
        let { type, defaultValue, fields, frontend, ...rest } = o
        const comp = (type2comp as any)[type] as Field<any> | undefined
        if (comp === ArrayField)
            fields = makeFields(fields)
        if (defaultValue !== undefined && type === 'boolean')
            rest.placeholder = `Default value is ${JSON.stringify(defaultValue)}`
        return { k, comp, fields, ...rest }
    })
}

const type2comp = {
    string: StringField,
    number: NumberField,
    boolean: BoolField,
    select: SelectField,
    multiselect: MultiSelectField,
    array: ArrayField,
    real_path: FileField,
}

export async function startPlugin(id: string) {
    try {
        await apiCall('start_plugin', { id })
        toast("Plugin started", h(PlayCircle, { color: 'success' }))
        return true
    }
    catch(e: any) {
        alertDialog(`Plugin ${id} didn't start, with error: ${String(e?.message || e)}`, 'error')
    }
}
