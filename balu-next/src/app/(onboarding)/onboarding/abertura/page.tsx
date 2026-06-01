// src/app/(onboarding)/onboarding/abertura/page.tsx
import AberturaWizard from '@/components/abertura/AberturaWizard';
import { submitAberturaAction } from './actions';

export default function AberturaPage() {
  return <AberturaWizard mode="criar" action={submitAberturaAction} />;
}
