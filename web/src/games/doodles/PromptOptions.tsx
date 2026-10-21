import { Button, Field, Input } from '../../components/ui';
import { doodlePrompts, pick } from '../common';

export function PromptField({ value, onChange, label = 'What to draw' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <div className="stack-sm">
      <Field label={label} hint="Use this idea, or write your own.">
        {(p) => <Input {...p} value={value} maxLength={80} onChange={(e) => onChange(e.target.value)} />}
      </Field>
      <Button size="sm" variant="ghost" icon="refresh" onClick={() => onChange(pick(doodlePrompts.filter((x) => x !== value)))}>
        Another idea
      </Button>
    </div>
  );
}
