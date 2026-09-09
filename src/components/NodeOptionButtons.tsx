// Shared button-group control for node fields that used to be <select> dropdowns (aspect ratio,
// resolution, variant count) — used identically by ImageGenNode/VideoGenNode/VideoGenProNode, so
// pulled out once rather than tripled.
export interface NodeOptionButtonsOption {
  value: string;
  label: string;
}

export default function NodeOptionButtons({
  options,
  value,
  onChange,
  disabled,
}: {
  options: NodeOptionButtonsOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="node-option-group nodrag">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`node-option-btn${o.value === value ? ' active' : ''}`}
          onClick={() => onChange(o.value)}
          disabled={disabled}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
