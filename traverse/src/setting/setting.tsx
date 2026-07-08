import { React } from 'jimu-core'
import type { AllWidgetSettingProps } from 'jimu-for-builder'
import { MapWidgetSelector } from 'jimu-ui/advanced/setting-components'
import type { Config, IMConfig } from '../config'

const S = {
  section: { marginBottom: '16px' } as React.CSSProperties,
  label: { fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: '#3d3d3d' } as React.CSSProperties,
  hint: { fontSize: '11px', color: '#888', marginTop: '4px' } as React.CSSProperties,
  btnGroup: { display: 'flex', gap: '6px' } as React.CSSProperties,
  select: {
    width: '100%', padding: '5px 8px', borderRadius: '4px',
    border: '1px solid #d4d4d4', fontSize: '12px', cursor: 'pointer'
  } as React.CSSProperties,
  divider: { borderTop: '1px solid #e8e8e8', margin: '16px 0' } as React.CSSProperties
}

const activeBtn = (active: boolean): React.CSSProperties => ({
  flex: 1, padding: '5px 10px', borderRadius: '4px', cursor: 'pointer',
  fontSize: '12px', fontWeight: 500,
  backgroundColor: active ? '#0079c1' : '#f3f3f3',
  color: active ? 'white' : '#3d3d3d',
  border: `1px solid ${active ? '#0079c1' : '#d4d4d4'}`
})

const Setting = (props: AllWidgetSettingProps<IMConfig>) => {
  const onMapWidgetSelected = (useMapWidgetIds: string[]) => {
    props.onSettingChange({ id: props.id, useMapWidgetIds })
  }

  const setConfig = <K extends keyof Config>(key: K, value: Config[K]) => {
    props.onSettingChange({ id: props.id, config: props.config.set(key, value) })
  }

  const { defaultBearingFormat, defaultDistanceUnit } = props.config

  return (
    <div className="widget-setting-traverse p-3">

      <div style={S.section}>
        <div style={S.label}>Map</div>
        <MapWidgetSelector onSelect={onMapWidgetSelected} useMapWidgetIds={props.useMapWidgetIds} />
      </div>

      <div style={S.divider} />

      <div style={S.section}>
        <div style={S.label}>Default Bearing Format</div>
        <div style={S.btnGroup}>
          <button style={activeBtn(defaultBearingFormat === 'quadrant')}
            onClick={() => setConfig('defaultBearingFormat', 'quadrant')}>
            Quadrant
          </button>
          <button style={activeBtn(defaultBearingFormat === 'azimuth')}
            onClick={() => setConfig('defaultBearingFormat', 'azimuth')}>
            Azimuth
          </button>
        </div>
        <div style={S.hint}>
          {defaultBearingFormat === 'quadrant'
            ? 'e.g. N 45°30\'00" E'
            : 'e.g. 045.5000 (0–360°, clockwise from north)'}
        </div>
      </div>

      <div style={S.section}>
        <div style={S.label}>Default Distance Unit</div>
        <select
          style={S.select}
          value={defaultDistanceUnit}
          onChange={ev => setConfig('defaultDistanceUnit', ev.target.value as any)}
        >
          <option value="feet">Feet</option>
          <option value="chains">Chains</option>
          <option value="meters">Meters</option>
        </select>
      </div>

    </div>
  )
}

export default Setting
