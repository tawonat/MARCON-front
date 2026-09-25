"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import styles from "../login.module.css";

export function PasskeyLogin({ identity, onCancel }: { identity: string; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn() {
    setBusy(true); setError("");
    try {
      const start = await fetch("/api/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login-options", identity }) });
      const options = await start.json();
      if (!start.ok) throw new Error(options.error || "Não foi possível iniciar o acesso.");
      const assertion = await startAuthentication({ optionsJSON: options });
      const finish = await fetch("/api/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login-verify", response: assertion }) });
      const result = await finish.json();
      if (!finish.ok) throw new Error(result.error || "Não foi possível validar a passkey.");
      if (typeof result.destination !== "string" || !/^\/inicio\/[a-z]+$/.test(result.destination)) throw new Error("Destino inválido.");
      window.location.assign(result.destination);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível acessar."); setBusy(false); }
  }

  return <section className={styles.faceTest} aria-labelledby="passkey-title">
    <h2 id="passkey-title">Entrar com passkey</h2>
    <p>Use a credencial cadastrada no seu perfil. O dispositivo pode solicitar reconhecimento facial, digital ou PIN.</p>
    {error && <p role="alert" className={styles.faceTestError}>{error}</p>}
    <div className={styles.faceTestActions}>
      <button type="button" onClick={signIn} disabled={busy}>{busy ? "Validando…" : "Continuar"}</button>
      <button type="button" onClick={onCancel} disabled={busy}>Voltar ao login</button>
    </div>
  </section>;
}
