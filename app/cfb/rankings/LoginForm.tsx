"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, null);
  return (
    <form action={formAction} className="login-form">
      <label htmlFor="pw">Password</label>
      <input
        id="pw"
        name="password"
        type="password"
        autoComplete="current-password"
        autoFocus
      />
      <button type="submit" disabled={pending}>
        {pending ? "…" : "Unlock"}
      </button>
      {state?.error && <span className="login-err">{state.error}</span>}
    </form>
  );
}
