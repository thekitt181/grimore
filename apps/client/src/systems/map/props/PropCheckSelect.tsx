import { PROP_ACTIVATE_CHECKS } from './propActivateChecks';

/** Shared skill/ability dropdown for reveal or activate checks. */
export function PropCheckSelect({
  value,
  onChange,
  title,
}: {
  value: string;
  onChange: (id: string) => void;
  title?: string;
}) {
  return (
    <select
      className="input-dark text-xs py-0.5 max-w-[9rem]"
      title={title ?? 'Skill or ability linked to VTT + D&D Beyond rolls'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Custom dice</option>
      <optgroup label="Abilities">
        {PROP_ACTIVATE_CHECKS.filter((c) => c.kind === 'ability').map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </optgroup>
      <optgroup label="Skills">
        {PROP_ACTIVATE_CHECKS.filter((c) => c.kind === 'skill').map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </optgroup>
    </select>
  );
}
