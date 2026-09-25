"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountRole } from "@/lib/accounts";
import styles from "./profile.module.css";

export default function ProfileForm({ name: initialName, email: initialEmail, role, persistent }: {
  name: string; email: string; role: AccountRole; persistent: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage("");
    if (newPassword !== confirmPassword) { setError("As novas senhas não coincidem."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, currentPassword, newPassword }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar o perfil.");
      if (newPassword) {
        router.push("/login");
        router.refresh();
        return;
      }
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setMessage("Perfil atualizado com sucesso.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o perfil.");
    } finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <div className={styles.container}>
      <div className={styles.header}>
        <div><span className={styles.eyebrow}>CONTA MARCON</span><h1>Editar perfil</h1><p>Atualize seus dados e suas credenciais de acesso.</p></div>
        <Link href={`/inicio/${role}`} className={styles.back}>Voltar</Link>
      </div>
      {!persistent && <p role="note" className={styles.notice}>Configure o MySQL para salvar alterações no perfil.</p>}
      <form className={styles.card} onSubmit={save}>
        <div className={styles.grid}>
          <label>Nome completo<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label>
          <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={190} /></label>
          <label>Senha atual<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
          <label>Nova senha (opcional)<input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Mínimo de 12 caracteres" /></label>
          <label>Confirme a nova senha<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {message && <p role="status" className={styles.success}>{message}</p>}
        <button type="submit" disabled={!persistent || busy}>{busy ? "Salvando…" : "Salvar perfil"}</button>
      </form>
    </div>
  </main>;
}
