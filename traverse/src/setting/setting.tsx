/** Traverse — settings panel (jimu-ui / ExB setting-component patterns). */
import { React } from 'jimu-core'
import { useTheme } from 'jimu-theme'
import type { AllWidgetSettingProps } from 'jimu-for-builder'
import { SettingSection, SettingRow, MapWidgetSelector } from 'jimu-ui/advanced/setting-components'
import { Button, Select, Option } from 'jimu-ui'
import type { Config, IMConfig } from '../config'

const Setting = (props: AllWidgetSettingProps<IMConfig>) => {
  const theme = useTheme()

  const onMapWidgetSelected = (useMapWidgetIds: string[]) => {
    props.onSettingChange({ id: props.id, useMapWidgetIds })
  }

  const setConfig = <K extends keyof Config>(key: K, value: Config[K]) => {
    props.onSettingChange({ id: props.id, config: props.config.set(key, value) })
  }

  const { defaultBearingFormat, defaultDistanceUnit } = props.config

  const hintStyle: React.CSSProperties = {
    fontSize: '11px', color: theme.sys.color.surface.paperHint, marginTop: theme.sys.spacing(1), lineHeight: 1.5
  }

  return (
    <div className="widget-setting-traverse">
      <SettingSection title="Map">
        <SettingRow>
          <MapWidgetSelector onSelect={onMapWidgetSelected} useMapWidgetIds={props.useMapWidgetIds} />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Default bearing format" role="group" aria-label="Default bearing format">
        <SettingRow>
          <div style={{ display: 'flex', gap: theme.sys.spacing(1), width: '100%' }}>
            <Button
              type={defaultBearingFormat === 'quadrant' ? 'primary' : 'secondary'}
              size="sm"
              style={{ flex: 1 }}
              onClick={() => setConfig('defaultBearingFormat', 'quadrant')}
            >Quadrant</Button>
            <Button
              type={defaultBearingFormat === 'azimuth' ? 'primary' : 'secondary'}
              size="sm"
              style={{ flex: 1 }}
              onClick={() => setConfig('defaultBearingFormat', 'azimuth')}
            >Azimuth</Button>
          </div>
        </SettingRow>
        <SettingRow>
          <div style={hintStyle}>
            {defaultBearingFormat === 'quadrant'
              ? 'e.g. N 45°30\'00" E'
              : 'e.g. 045.5000 (0–360°, clockwise from north)'}
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title="Default distance unit">
        <SettingRow tag="label" label="Unit">
          <Select
            size="sm"
            value={defaultDistanceUnit}
            aria-label="Default distance unit"
            onChange={(_evt, value) => setConfig('defaultDistanceUnit', value as any)}
          >
            <Option value="feet">Feet</Option>
            <Option value="chains">Chains</Option>
            <Option value="meters">Meters</Option>
          </Select>
        </SettingRow>
      </SettingSection>
    </div>
  )
}

export default Setting
