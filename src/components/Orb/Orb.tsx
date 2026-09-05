import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OrbProps, OrbSignal, OrbThemeRendererControlProps } from './Orb.types'
import { deriveOrbState, deriveOrbVolume } from './signals'
import { DebugTheme } from '../../themes/debug'
import { CircleTheme } from '../../themes/circle'
import { BarsTheme } from '../../themes/bars'
import { CloudTheme } from '../../themes/cloud'
import { RadialTheme } from '../../themes/radial'

export function Orb({
  signal: signalProp,
  state: stateProp,
  volume: volumeProp,
  adapter,
  theme = 'debug',
  size = 200,
  className,
  style,
  disabled = false,
  interactive: interactiveProp = true,
  onStart,
  onStop,
  renderTheme,
  ...htmlProps
}: OrbProps) {
  const [adapterSignal, setAdapterSignal] = useState<OrbSignal>({ state: 'idle' })

  useEffect(() => {
    setAdapterSignal({ state: 'idle' })

    if (!adapter) return
    const unsubscribe = adapter.subscribe(setAdapterSignal)
    return unsubscribe
  }, [adapter])

  const activeSignal = signalProp ?? adapterSignal
  const state = deriveOrbState(stateProp, signalProp, adapterSignal)
  const activity = deriveOrbVolume(volumeProp, state, activeSignal)
  const inputVolume = activeSignal.inputVolume ?? 0
  const outputVolume = activeSignal.outputVolume ?? 0
  const rendererSignal = useMemo<OrbSignal>(
    () => ({ ...activeSignal, state, inputVolume, outputVolume }),
    [activeSignal, inputVolume, outputVolume, state],
  )

  const isActive = state !== 'idle' && state !== 'error'

  const start = useCallback(() => {
    if (disabled) return
    if (onStart) return onStart()
    return adapter?.start?.()
  }, [adapter, disabled, onStart])

  const stop = useCallback(() => {
    if (disabled) return
    if (onStop) return onStop()
    return adapter?.stop?.()
  }, [adapter, disabled, onStop])

  const toggle = useCallback(() => (isActive ? stop() : start()), [isActive, start, stop])

  const canInteract = isActive ? !!(adapter?.stop || onStop) : !!(adapter?.start || onStart)
  const interactive = interactiveProp && canInteract
  const clickHandler = interactive && !disabled ? toggle : undefined
  const ariaLabel =
    htmlProps['aria-label'] ??
    (interactive ? `${isActive ? 'Stop' : 'Start'} voice session` : undefined)
  const controlProps = {
    ...htmlProps,
    'aria-label': ariaLabel,
  }

  if (renderTheme) {
    const customControlProps: OrbThemeRendererControlProps = {
      ...htmlProps,
      type: 'button',
      disabled: disabled || !interactive,
      onClick: clickHandler,
      'data-orb-ui-state': state,
      'aria-label': ariaLabel,
    }

    return renderTheme({
      state,
      signal: rendererSignal,
      inputVolume,
      outputVolume,
      activity,
      size,
      isActive,
      interactive,
      disabled,
      start,
      stop,
      toggle,
      rootProps: {
        className,
        style: {
          width: size,
          height: size,
          ...style,
        },
        'data-orb-ui-theme': 'custom',
        'data-orb-ui-state': state,
      },
      controlProps: customControlProps,
    })
  }

  const sharedThemeProps = {
    state,
    volume: activity,
    size,
    className,
    style,
    disabled,
    ...controlProps,
  }

  const interactiveThemeProps = {
    ...sharedThemeProps,
    interactive,
  }

  switch (theme) {
    case 'circle':
      return <CircleTheme {...interactiveThemeProps} onClick={clickHandler} />
    case 'bars':
      return <BarsTheme {...interactiveThemeProps} onClick={clickHandler} />
    case 'cloud':
      return <CloudTheme {...interactiveThemeProps} onClick={clickHandler} />
    case 'radial':
      return <RadialTheme {...interactiveThemeProps} onClick={clickHandler} />
    case 'debug':
    default:
      return (
        <DebugTheme
          {...sharedThemeProps}
          disabled={disabled || !interactiveProp}
          onStart={disabled || !interactiveProp ? undefined : start}
          onStop={disabled || !interactiveProp ? undefined : stop}
        />
      )
  }
}
