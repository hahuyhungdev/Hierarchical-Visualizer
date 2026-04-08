import { memo, useCallback } from "react";
import { LAYER_COLORS } from "../layout";

export type Theme = "dark" | "light";
export type EdgeStyle = "smoothstep" | "straight" | "bezier";

export interface CustomColors {
  bg?: string;
  surface?: string;
  accent?: string;
  text?: string;
  border?: string;
  gridColor?: string;
  nodeBg?: string;
}

export interface SettingsState {
  theme: Theme;
  hiddenLayers: Set<string>;
  edgeStyle: EdgeStyle;
  showLabels: boolean;
  animateEdges: boolean;
  customColors: CustomColors;
  nodeSpacing: number; // 0=compact, 1=normal, 2=spacious
  gridVisible: boolean;
}

interface SettingsPanelProps {
  settings: SettingsState;
  onChange: (s: SettingsState) => void;
  onClose: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  groupCount: number;
  expandedCount: number;
}

const LAYERS = [
  { key: "page", label: "Pages" },
  { key: "feature", label: "Features" },
  { key: "shared", label: "Shared / UI" },
  { key: "api_service", label: "API Services" },
  { key: "api_endpoint", label: "Endpoints" },
];

const COLOR_FIELDS: { key: keyof CustomColors; label: string; desc: string }[] = [
  { key: "bg", label: "Background", desc: "Main canvas background" },
  { key: "surface", label: "Surface", desc: "Panels, toolbar, cards" },
  { key: "nodeBg", label: "Node Fill", desc: "Node background color" },
  { key: "accent", label: "Accent", desc: "Highlights, links, focus" },
  { key: "text", label: "Text", desc: "Primary text color" },
  { key: "border", label: "Border", desc: "Borders and dividers" },
  { key: "gridColor", label: "Grid", desc: "Canvas grid dots" },
];

const SPACING_LABELS = ["Compact", "Normal", "Spacious"] as const;

export const SettingsPanel = memo(function SettingsPanel({
  settings,
  onChange,
  onClose,
  onExpandAll,
  onCollapseAll,
  groupCount,
  expandedCount,
}: SettingsPanelProps) {
  const update = useCallback(
    (patch: Partial<SettingsState>) => onChange({ ...settings, ...patch }),
    [settings, onChange],
  );

  const toggleLayer = useCallback(
    (layer: string) => {
      const next = new Set(settings.hiddenLayers);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      onChange({ ...settings, hiddenLayers: next });
    },
    [settings, onChange],
  );

  const setColor = useCallback(
    (key: keyof CustomColors, value: string) => {
      update({ customColors: { ...settings.customColors, [key]: value } });
    },
    [settings, update],
  );

  const clearColor = useCallback(
    (key: keyof CustomColors) => {
      const next = { ...settings.customColors };
      delete next[key];
      update({ customColors: next });
    },
    [settings, update],
  );

  const hasAnyCustomColor = Object.values(settings.customColors).some(Boolean);

  return (
    <div className="settings-panel">
      <div className="settings-panel__header">
        <span>⚙ Settings</span>
        <button className="settings-panel__close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="settings-panel__body">
        {/* ─── Theme ─── */}
        <div className="settings-section">
          <div className="settings-section__title">Theme</div>
          <div className="theme-switcher">
            <button
              className={`theme-switcher__btn ${settings.theme === "dark" ? "theme-switcher__btn--active" : ""}`}
              onClick={() => update({ theme: "dark" })}
            >
              🌙 Dark
            </button>
            <button
              className={`theme-switcher__btn ${settings.theme === "light" ? "theme-switcher__btn--active" : ""}`}
              onClick={() => update({ theme: "light" })}
            >
              ☀️ Light
            </button>
          </div>
        </div>

        {/* ─── Custom Colors ─── */}
        <div className="settings-section">
          <div className="settings-section__title">
            Custom Colors
            {hasAnyCustomColor && (
              <button
                className="settings-reset-btn"
                onClick={() => update({ customColors: {} })}
              >
                Reset all
              </button>
            )}
          </div>
          <div className="color-grid">
            {COLOR_FIELDS.map(({ key, label, desc }) => {
              const value = settings.customColors[key];
              return (
                <div className="color-field" key={key}>
                  <label className="color-field__label" title={desc}>
                    {label}
                  </label>
                  <div className="color-field__controls">
                    <input
                      type="color"
                      className="color-field__picker"
                      value={value || getComputedDefault(key, settings.theme)}
                      onChange={(e) => setColor(key, e.target.value)}
                      title={desc}
                    />
                    {value && (
                      <button
                        className="color-field__clear"
                        onClick={() => clearColor(key)}
                        title="Reset to default"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Layer visibility ─── */}
        <div className="settings-section">
          <div className="settings-section__title">Layer Visibility</div>
          <div className="layer-chips">
            {LAYERS.map((l) => {
              const hidden = settings.hiddenLayers.has(l.key);
              return (
                <button
                  key={l.key}
                  className={`layer-chip ${hidden ? "layer-chip--hidden" : ""}`}
                  onClick={() => toggleLayer(l.key)}
                  title={hidden ? `Show ${l.label}` : `Hide ${l.label}`}
                >
                  <span
                    className="layer-chip__dot"
                    style={{ background: LAYER_COLORS[l.key] }}
                  />
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── Directory groups ─── */}
        <div className="settings-section">
          <div className="settings-section__title">
            Directory Groups ({expandedCount}/{groupCount} expanded)
          </div>
          <div className="settings-actions">
            <button className="settings-action-btn" onClick={onExpandAll}>
              ⊞ Expand All
            </button>
            <button className="settings-action-btn" onClick={onCollapseAll}>
              ⊟ Collapse All
            </button>
          </div>
        </div>

        {/* ─── Edge Style ─── */}
        <div className="settings-section">
          <div className="settings-section__title">Edges</div>
          <div className="settings-row">
            <span className="settings-row__label">Curve</span>
            <select
              className="settings-select"
              value={settings.edgeStyle}
              onChange={(e) => update({ edgeStyle: e.target.value as EdgeStyle })}
            >
              <option value="smoothstep">Smooth Step</option>
              <option value="bezier">Bezier</option>
              <option value="straight">Straight</option>
            </select>
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Animate on highlight</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.animateEdges}
                onChange={(e) => update({ animateEdges: e.target.checked })}
              />
              <span className="toggle-switch__track" />
            </label>
          </div>
        </div>

        {/* ─── Layout ─── */}
        <div className="settings-section">
          <div className="settings-section__title">Layout</div>
          <div className="settings-row">
            <span className="settings-row__label">Node spacing</span>
            <div className="spacing-selector">
              {SPACING_LABELS.map((label, i) => (
                <button
                  key={i}
                  className={`spacing-btn ${settings.nodeSpacing === i ? "spacing-btn--active" : ""}`}
                  onClick={() => update({ nodeSpacing: i })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Show grid</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.gridVisible}
                onChange={(e) => update({ gridVisible: e.target.checked })}
              />
              <span className="toggle-switch__track" />
            </label>
          </div>
        </div>

        {/* ─── Display ─── */}
        <div className="settings-section">
          <div className="settings-section__title">Display</div>
          <div className="settings-row">
            <span className="settings-row__label">Show file paths</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.showLabels}
                onChange={(e) => update({ showLabels: e.target.checked })}
              />
              <span className="toggle-switch__track" />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
});

/** Fallback defaults for the color picker initial value when no custom color is set */
function getComputedDefault(key: keyof CustomColors, theme: Theme): string {
  const dark: Record<keyof CustomColors, string> = {
    bg: "#0a0e1a",
    surface: "#131827",
    accent: "#818cf8",
    text: "#e2e8f0",
    border: "#232d44",
    gridColor: "#1e293b",
    nodeBg: "#131827",
  };
  const light: Record<keyof CustomColors, string> = {
    bg: "#f1f5f9",
    surface: "#ffffff",
    accent: "#6366f1",
    text: "#1e293b",
    border: "#cbd5e1",
    gridColor: "#e2e8f0",
    nodeBg: "#ffffff",
  };
  return theme === "light" ? light[key] : dark[key];
}
