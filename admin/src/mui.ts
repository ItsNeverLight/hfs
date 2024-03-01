// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt
// all content here is shared between client and server

import { PauseCircle, PlayCircle, Refresh, SvgIconComponent } from '@mui/icons-material'
import { SxProps } from '@mui/system'
import {
    createElement as h, FC, forwardRef, Fragment, ReactElement, ReactNode, useCallback, useEffect, useRef,
    ForwardedRef, useState, useMemo
} from 'react'
import { Box, BoxProps, Breakpoint, ButtonProps, CircularProgress, IconButton, IconButtonProps, Link, LinkProps,
    Tooltip, TooltipProps, useMediaQuery } from '@mui/material'
import { formatPerc, isIpLan, isIpLocalHost, prefix, WIKI_URL } from '../../src/cross'
import { dontBotherWithKeys, restartAnimation, useBatch, useStateMounted } from '@hfs/shared'
import { Promisable, StringField } from '@hfs/mui-grid-form'
import { alertDialog, confirmDialog, toast } from './dialog'
import { LoadingButton, LoadingButtonProps } from '@mui/lab'
import { Link as RouterLink } from 'react-router-dom'
import { SvgIconProps } from '@mui/material/SvgIcon/SvgIcon'
import _ from 'lodash'
import { ALL as COUNTRIES } from './countries'
import { apiCall } from '@hfs/shared/api'

export function spinner() {
    return h(CircularProgress)
}

// return true if same size or larger
export function useBreakpoint(breakpoint: Breakpoint) {
    return useMediaQuery((theme: any) => theme.breakpoints.up(breakpoint), { noSsr:true }) // without noSsr, first execution always returns false
}

// for debug purposes
export function useLogBreakpoint() {
    const breakpoints = ['xl', 'lg', 'md', 'sm', 'xs'] as const
    console.log('BREAKPOINT', breakpoints[_.findIndex(breakpoints.map(x => useBreakpoint(x)), x => x)])
}

// for debug purposes
export function useLogMount(name: string) {
    useEffect(() => {
        console.log('MOUNT', name)
        return () => console.log('UNMOUNT', name)
    }, [])
}

interface IconProgressProps {
    icon: SvgIconComponent,
    progress: number,
    offset?: number,
    sx?: SxProps,
    title?: ReactNode
}
export function IconProgress({ icon, progress, offset, title, sx }: IconProgressProps) {
    return h(Flex, { vert: true, center: true },
        h(icon, { sx: { position:'absolute', ml: '4px' } }),
        h(CircularProgress, {
            value: progress * 100 || 0,
            variant: 'determinate',
            size: 32,
            sx: { position: 'absolute' },
        }),
        hTooltip(title ?? (_.isNumber(progress) ? formatPerc(progress) : "Size unknown"), '',
            h(CircularProgress, {
                color: 'success',
                value: (offset || 1e-7) * 100,
                variant: 'determinate',
                size: 32,
                sx: { display: 'flex', ...sx }, // workaround: without this the element has 0 width when the space is crammy (monitor/file)
            }),
        )
    )
}

type FlexProps = SxProps & { vert?: boolean, center?: boolean, children?: ReactNode, props?: BoxProps }
export function Flex({ vert=false, center=false, children=null, props={}, ...rest }: FlexProps) {
    return h(Box, {
        sx: {
            display: 'flex',
            gap: '.8em',
            flexDirection: vert ? 'column' : undefined,
            alignItems: vert ? undefined : 'center',
            ...center && { justifyContent: 'center' },
            ...rest,
        },
        ...props
    }, children)
}


export function wikiLink(uri: string, content: ReactNode) {
    if (Array.isArray(content))
        content = dontBotherWithKeys(content)
    return h(Link, { href: WIKI_URL + uri, target: 'help' }, content)
}

export function WildcardsSupported() {
    return wikiLink('Wildcards', "Wildcards supported")
}

export function reloadBtn(onClick: any, props?: any) {
    return h(IconBtn, { icon: Refresh, title: "Reload", onClick, ...props })
}

export function modifiedProps(modified: boolean | undefined) {
    return modified ? { sx: { outline: '2px solid' } } : undefined
}

function useRefPass<T=unknown>(forwarded: ForwardedRef<any>) {
    const ref = useRef<T | null>(null)
    return Object.assign(ref, {
        pass(el: T){
            ref.current = el
            if (_.isFunction(forwarded))
                forwarded(el)
            else if (forwarded)
                forwarded.current = el
        },

    })
}

interface IconBtnProps extends Omit<IconButtonProps, 'disabled'|'title'|'onClick'> {
    title?: ReactNode
    icon: SvgIconComponent
    disabled?: boolean | string
    progress?: boolean | number
    link?: string
    confirm?: string
    doneMessage?: boolean | string // displayed only if the result of onClick !== false
    tooltipProps?: Partial<TooltipProps>
    modified?: boolean
    onClick?: (...args: Parameters<NonNullable<IconButtonProps['onClick']>>) => Promisable<any>
}

export const IconBtn = forwardRef(({ title, icon, onClick, disabled, progress, link, tooltipProps, confirm, doneMessage, sx, modified, ...rest }: IconBtnProps, forwarded: ForwardedRef<HTMLButtonElement>) => {
    const [loading, setLoading] = useStateMounted(false)
    if (typeof disabled === 'string')
        title = disabled
    if (link)
        onClick = () => window.open(link)
    disabled = loading || Boolean(progress) || disabled === undefined ? undefined : Boolean(disabled)
    const ref = useRefPass<HTMLButtonElement>(forwarded)
    let ret: ReturnType<FC> = h(IconButton, {
            ref,
            'aria-hidden': disabled,
            ..._.merge(modifiedProps(modified),
                { disabled, sx: { height: 'fit-content', ...sx } },
                rest),
            async onClick(...args) {
                if (confirm && !await confirmDialog(confirm)) return
                const ret = onClick?.apply(this,args)
                if (ret && ret instanceof Promise) {
                    setLoading(true)
                    ret.then(x => x !== false && execDoneMessage(doneMessage, ref.current), alertDialog)
                        .finally(()=> setLoading(false))
                }
            }
        },
        (progress || loading) && progress !== false  // false is also useful to inhibit behavior with loading
        && h(CircularProgress, {
            ...(typeof progress === 'number' ? { value: progress*100, variant: 'determinate' } : null),
            style: { position:'absolute', top: '10%', left: '10%', width: '80%', height: '80%' }
        }),
        h(icon)
    )
    const aria = rest['aria-label'] ?? (_.isString(title) ? title : undefined)
    if (title) {
        if (disabled)
            ret = h('span', { role: 'button', 'aria-label': aria, 'aria-disabled': disabled }, ret)
        ret = hTooltip(title, aria, ret, tooltipProps)
    }
    return ret
})

interface BtnProps extends Omit<LoadingButtonProps,'disabled'|'title'|'onClick'> {
    icon?: SvgIconComponent
    title?: ReactNode
    disabled?: boolean | string
    progress?: boolean | number
    link?: string
    confirm?: boolean | ReactNode
    labelFrom?: Breakpoint
    doneMessage?: boolean | string // displayed only if the result of onClick !== false
    tooltipProps?: TooltipProps
    onClick?: (...args: Parameters<NonNullable<ButtonProps['onClick']>>) => Promisable<any>
}

export const Btn = forwardRef(({ icon, title, onClick, disabled, progress, link, tooltipProps, confirm, doneMessage, labelFrom, children, ...rest }: BtnProps, ref: any) => {
    const [loading, setLoading] = useStateMounted(false)
    if (typeof disabled === 'string') {
        title = disabled
        disabled = true
    }
    if (link)
        onClick = () => window.open(link)
    const showLabel = useBreakpoint(labelFrom || 'xs')
    let ret: ReturnType<FC> = h(LoadingButton, {
        ref,
        variant: 'contained',
        startIcon: icon && h(icon),
        loading: Boolean(loading || progress),
        loadingPosition: icon && 'start',
        loadingIndicator: typeof progress !== 'number' ? undefined
            : h(CircularProgress, { size: '1rem', value: progress*100, variant: 'determinate' }),
        disabled,
        'aria-hidden': disabled,
        ...rest,
        children: showLabel && children,
        sx: {
            ...rest.sx,
            ...!showLabel && {
                minWidth: 'auto',
                px: 1,
                py: '7px',
                '& span': { mx:0 },
            }
        },
        async onClick(...args) {
            if (confirm && !await confirmDialog(confirm === true ? "Are you sure?" : confirm)) return
            const ret = onClick?.apply(this,args)
            if (ret && ret instanceof Promise) {
                setLoading(true)
                ret.then(x => x !== false && execDoneMessage(doneMessage), alertDialog)
                    .finally(()=> setLoading(false))
            }
        }
    })
    const aria = rest['aria-label'] ?? (_.isString(title) ? title : undefined)
    if (title) {
        // having this span-wrapper conditioned by if(disabled) is causing a strange (harmless?) warning by mui-popper as soon as you click, so we don't
        ret = h('span', { role: 'button', 'aria-label': aria, 'aria-disabled': disabled }, ret)
        ret = hTooltip(title, aria, ret, tooltipProps)
    }
    return ret
})

function execDoneMessage(msg: boolean | string | undefined, el?: HTMLElement | null) {
    if (el)
        restartAnimation(el, 'success .5s')
    if (msg)
        toast(msg === true ? "Operation completed" : msg, 'success')
}

export function iconTooltip(icon: SvgIconComponent, tooltip: ReactNode, sx?: SxProps, props?: SvgIconProps) {
    return hTooltip(tooltip, undefined, h(icon, { sx, ...props }) )
}

export function InLink(props:any) {
    return h(Link, { component: RouterLink, ...props })
}

export const Center = forwardRef((props: BoxProps, ref) =>
    h(Box, { ref, display:'flex', height:'100%', width:'100%', justifyContent:'center', alignItems:'center',  flexDirection: 'column', ...props }))

export function LinkBtn({ ...rest }: LinkProps) {
    return h(Link, {
        ...rest,
        href: '',
        sx: { cursor: 'pointer', ...rest.sx },
        role: 'button',
        onClick(ev) {
            ev.preventDefault()
            rest.onClick?.(ev)
        }
    })
}

export function usePauseButton(props?: Partial<IconBtnProps>) {
    const [going, btn] = useToggleButton("Pause", "Play", v => ({
        icon: v ? PauseCircle : PlayCircle,
        sx: { rotate: v ? '180deg' : '0deg' },
        ...props,
    }), true)
    return { pause: !going, pauseButton: btn }
}

export function useToggleButton(onTitle: string, offTitle: undefined | string, iconBtn: (state:boolean) => Omit<IconBtnProps, 'onClick'>, def=false) {
    const [state, setState] = useState(def)
    const toggle = useCallback(() => setState(x => !x), [])
    const props = iconBtn(state)
    const el = useMemo(() => h(IconBtn, {
        size: 'small',
        color: state ? 'primary' : 'default',
        title: state || offTitle === undefined ? onTitle : offTitle,
        'aria-label': onTitle, // aria should be steady, and rely on aria-pressed
        'aria-pressed': state,
        ...props,
        sx: { transition: 'all .5s', ...props.sx },
        onClick: toggle,
    }), [state]) // memoize or tooltip flickers on mouse-over
    return [state, el] as const
}

export const NetmaskField = StringField

export function Country({ code, ip, def, long, short }: { code: string, ip?: string, def?: ReactNode, long?: boolean, short?: boolean }) {
    const good = ip && !isIpLocalHost(ip) && !isIpLan(ip)
    const { data } = useBatch(code === undefined && good && ip2countryBatch, ip, { delay: 100 }) // query if necessary
    code ||= data || ''
    const country = code && _.find(COUNTRIES, { code })
    return !country ? h(Fragment, {}, def)
        : hTooltip(long ? undefined : country.name, undefined, h('span', {},
            h('img', {
                className: 'flag icon-w-text',
                src: `flags/${code.toLowerCase()}.png`,
                alt: country.name,
                ...long && { 'aria-hidden': true },
            }),
            long ? country.name + prefix(' (', short && code, ')') : code
        ) )
}

async function ip2countryBatch(ips: string[]) {
    const res = await apiCall('ip_country', { ips })
    return res.codes as string[]
}

// force you to think of aria when adding a tooltip
export function hTooltip(title: ReactNode, ariaLabel: string | undefined, children: ReactElement, props?: Omit<TooltipProps, 'title' | 'children'> & { key?: any }) {
    return h(Tooltip, { title, children,
        ...ariaLabel === '' ? { 'aria-hidden': true } : { 'aria-label': ariaLabel },
        ...props
    })
}