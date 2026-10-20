import { startTransition, type FormEvent } from "react";

/**
 * Submit a form to a useActionState dispatcher without React's automatic form
 * reset, so a validation error never wipes what the user typed.
 */
export function submitWith(dispatch: (form: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => dispatch(form));
  };
}
