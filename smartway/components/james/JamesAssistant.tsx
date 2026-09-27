"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BrandLogo } from "@/app/components/brand-logo";
import { useDemoStore } from "@/components/workspace/demo-store";
import { useJamesVoice } from "./useJamesVoice";
import { explicitConfirmation } from "@/lib/james-voice";
import type { JamesCart } from "@/lib/james-actions";
import styles from "./JamesAssistant.module.css";
import { useJamesPet, type Dock } from "./useJamesPet";
type Reply = {
  reply?: string;
  error?: string;
  cart?: JamesCart;
  items?: {
    code: string;
    name: string;
    quantity: number;
    unit: string;
    packSize: number;
    available: number;
  }[];
  confirmationToken?: string;
  submitted?: boolean;
  result?: { ids: number[] };
  href?: string;
  navigate?: boolean;
  choices?: { code: string; name: string }[];
  dashboard?: {
    scope: string;
    period: string;
    updatedAt: string;
    metrics: {
      id: string;
      label: string;
      value: number | null;
      unit: string;
      definition: string;
    }[];
  };
};
export default function JamesAssistant({ userId }: { userId: string }) {
  const { cart, setCart } = useDemoStore();
  const pathname = usePathname(),
    router = useRouter();
  const [open, setOpen] = useState(false),
    [authorized, setAuthorized] = useState(true),
    [input, setInput] = useState(""),
    [state, setState] = useState("idle"),
    [error, setError] = useState(""),
    [voiceOutput, setVoiceOutput] = useState(true),
    [provider, setProvider] = useState("nvidia");
  const [messages, setMessages] = useState<{ user?: string; answer?: Reply }[]>(
      [],
    ),
    [review, setReview] = useState<{ token: string; cart: string } | null>(
      null,
    );
  const dialog = useRef<HTMLDialogElement>(null),
    symbol = useRef<HTMLDivElement>(null),
    field = useRef<HTMLInputElement>(null),
    launcher = useRef<HTMLButtonElement>(null),
    log = useRef<HTMLDivElement>(null),
    pending = useRef<AbortController | null>(null),
    speech = useRef<SpeechSynthesisUtterance | null>(null),
    suppress = useRef(0),
    cartRef = useRef(cart),
    reviewRef = useRef(review);
  const pet = useJamesPet(userId, pathname, open);
  const resumeVoice = useRef<() => void>(() => {});
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    cartRef.current = cart;
    reviewRef.current = review;
  }, [cart, review]);
  const stopSpeech = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    const wasSpeaking = !!speech.current;
    if (speech.current) {
      speech.current.onend = null;
      speech.current.onerror = null;
      speech.current.onboundary = null;
      speech.current = null;
    }
    window.speechSynthesis?.cancel();
    suppress.current = wasSpeaking ? Date.now() + 600 : 0;
    resumeVoice.current();
  }, []);
  const show = useCallback(() => {
    setOpen(true);
    dialog.current?.showModal();
  }, []);
  const voice = useJamesVoice(
    (text) => {
      if (Date.now() < suppress.current) return;
      setInput(text);
      void send(text);
    },
    () => {
      if (Date.now() < suppress.current) return;
      show();
      setState("listening");
    },
    (message) => {
      setError(message);
      pending.current?.abort();
      pending.current = null;
      stopSpeech();
      setState("idle");
    },
  );
  const stopVoice = voice.stop;
  function pause() {
    stopVoice();
    stopSpeech();
    pending.current?.abort();
    pending.current = null;
    setState("idle");
  }
  useEffect(() => {
    resumeVoice.current = voice.resume;
  }, [voice.resume]);
  function close() {
    pet.clearHighlight();
    pending.current?.abort();
    pending.current = null;
    stopVoice();
    stopSpeech();
    setOpen(false);
    setState("idle");
    dialog.current?.close();
    launcher.current?.focus();
  }
  function speak(text: string) {
    if (!voiceOutput || !window.speechSynthesis) return;
    const local = window.speechSynthesis
      .getVoices()
      .find((v) => v.localService && v.lang.startsWith("pt"));
    if (!local) {
      setError(
        "Voz local em português indisponível. Leia a resposta ou instale uma voz no sistema.",
      );
      return;
    }
    stopSpeech();
    // Disable the recognizer while TTS speaks: its own summary must never confirm a request.
    voice.suspend();
    suppress.current = Infinity;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = local;
    u.lang = "pt-BR";
    speech.current = u;
    setState("speaking");
    u.onboundary = () => {
      if (
        matchMedia("(prefers-reduced-motion: reduce), (update: slow)").matches
      )
        return;
      symbol.current?.querySelector(`.${styles.orbit}`)?.animate(
        [
          { opacity: 0.4, transform: "rotate(-10deg) scale(1)" },
          { opacity: 1, transform: "rotate(-10deg) scale(1.08)" },
          { opacity: 0.4, transform: "rotate(-10deg) scale(1)" },
        ],
        { duration: 220 },
      );
    };
    const finish = () => {
      suppress.current = Date.now() + 800;
      speech.current = null;
      resumeTimer.current = setTimeout(() => resumeVoice.current(), 850);
      setState(reviewRef.current ? "confirming" : "idle");
    };
    u.onend = finish;
    u.onerror = () => {
      finish();
      setError("Falha na voz. A resposta continua no texto.");
    };
    window.speechSynthesis.speak(u);
  }
  async function send(text: string, confirm = false) {
    if (pending.current || !text.trim()) return;
    const currentReview = reviewRef.current;
    if (/^(cancelar|cancele|nao|não)[.!]?$/i.test(text.trim())) {
      setReview(null);
      reviewRef.current = null;
      setMessages((m) => [
        ...m,
        {
          answer: {
            reply: currentReview
              ? "Envio cancelado. Seu carrinho foi mantido."
              : "Não há envio aguardando confirmação. Para cancelar uma requisição já enviada, abra seus pedidos.",
          },
        },
      ]);
      setInput("");
      stopSpeech();
      setState("idle");
      return;
    }
    if (explicitConfirmation(text)) confirm = true;
    if (
      confirm &&
      (!currentReview || currentReview.cart !== JSON.stringify(cartRef.current))
    ) {
      setError("Revise o carrinho antes de confirmar.");
      return;
    }
    if (!confirm) {
      setReview(null);
      reviewRef.current = null;
    }
    stopSpeech();
    setError("");
    setState("processing");
    setMessages((m) => [...m.slice(-19), { user: text }]);
    setInput("");
    const controller = new AbortController();
    pending.current = controller;
    try {
      const r = await fetch("/api/james/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          confirm
            ? {
                mode: "confirm",
                token: currentReview!.token,
                confirmation: "confirmar requisicao",
              }
            : {
                message: text,
                page: pathname,
                cart: cartRef.current,
                history: messages
                  .slice(-6)
                  .map((m) => m.user || m.answer?.reply || ""),
              },
        ),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(50000),
        ]),
      });
      const data: Reply = await r.json();
      if (controller.signal.aborted) return;
      if (r.status === 401) {
        close();
        setAuthorized(false);
        setMessages([]);
        setCart([]);
        return;
      }
      if (!r.ok) throw new Error(data.error || "Não foi possível concluir.");
      if (data.cart) {
        setCart(data.cart);
        cartRef.current = data.cart;
      }
      const next = data.confirmationToken
        ? { token: data.confirmationToken, cart: JSON.stringify(data.cart) }
        : null;
      setReview(next);
      reviewRef.current = next;
      setMessages((m) => [...m, { answer: data }]);
      setState(next ? "confirming" : "idle");
      if (data.navigate && data.href) {
        close();
        router.push(data.href);
      } else if (data.reply) speak(data.reply);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : "Falha de rede.");
        setInput(text);
        setState(currentReview ? "confirming" : "idle");
      }
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }
  useEffect(() => {
    const c = new AbortController();
    const verify = async () => {
      try {
        const r = await fetch("/api/james/chat", {
          signal: c.signal,
          cache: "no-store",
        });
        const data = await r.json();
        if (r.status === 401) {
          stopVoice();
          stopSpeech();
          pending.current?.abort();
          setAuthorized(false);
          setOpen(false);
          setMessages([]);
          setReview(null);
          dialog.current?.close();
        } else if (r.ok && data.userId !== userId) {
          stopVoice();
          stopSpeech();
          pending.current?.abort();
          setAuthorized(false);
          setMessages([]);
          dialog.current?.close();
        } else if (r.ok) setProvider(data.provider);
      } catch {
        /* Every request also validates the session. */
      }
    };
    void verify();
    const hidden = () => {
      if (document.hidden) {
        stopSpeech();
        setState("idle");
      }
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("focus", verify);
    const timer = setInterval(verify, 30000);
    return () => {
      c.abort();
      clearInterval(timer);
      window.removeEventListener("focus", verify);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [pathname, stopVoice, stopSpeech, userId]);
  useEffect(
    () => () => {
      stopVoice();
      stopSpeech();
      pending.current?.abort();
    },
    [stopVoice, stopSpeech],
  );
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages, state]);
  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    if (
      !symbol.current ||
      matchMedia("(prefers-reduced-motion: reduce), (update: slow)").matches
    )
      return;
    const b = symbol.current.getBoundingClientRect(),
      x = innerWidth / 2 - b.x - b.width / 2,
      y = innerHeight / 2 - b.y - b.height / 2;
    const a = symbol.current.animate(
      [
        {
          transform: `translate(${x}px,${y}px) perspective(600px) rotateY(-18deg) scale(2.2)`,
          offset: 0,
        },
        {
          transform: `translate(${x}px,${y}px) perspective(600px) rotateY(10deg) scale(2.2)`,
          offset: 0.3,
        },
        { transform: "perspective(600px) rotateY(-8deg)" },
      ],
      { duration: 1000, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
    return () => a.cancel();
  }, [open]);
  const validReview = review && review.cart === JSON.stringify(cart);
  if (!authorized || ["/login", "/"].includes(pathname)) return null;
  return (
    <div
      ref={pet.root}
      className={styles.root}
      data-james-pet
      data-dock={pet.dock}
      data-state={error ? "error" : state}
    >
      {!open && pet.tip && (
        <div className={styles.tip}>
          <p>{pet.tip}</p>
          <button onClick={pet.point}>Mostrar onde</button>
          <button onClick={() => pet.update({ quiet: true })}>
            Silenciar dicas
          </button>
        </div>
      )}
      <button
        className={styles.launcher}
        ref={launcher}
        onClick={show}
        aria-label="Abrir James"
        aria-haspopup="dialog"
      >
        <BrandLogo decorative compact />
        <span>{voice.listening ? "James · escuta ativa" : "James"}</span>
      </button>
      {voice.listening && !open && (
        <button className={styles.pause} onClick={pause}>
          Desligar escuta
        </button>
      )}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby="james-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        {open && (
          <>
            <div ref={symbol} className={styles.symbol} aria-hidden="true">
              <div className={styles.orbit} />
              <BrandLogo decorative />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <i
                  key={i}
                  className={styles.particle}
                  style={{ "--i": i } as React.CSSProperties}
                />
              ))}
            </div>
            <section className={styles.panel}>
              <header>
                <div>
                  <h2 id="james-title">James</h2>
                  <small>Seu assistente MARCON</small>
                </div>
                <button onClick={close} aria-label="Fechar James">
                  Fechar
                </button>
              </header>
              <div
                ref={log}
                className={styles.messages}
                role="log"
                aria-live="polite"
                aria-label="Conversa com James"
              >
                {!messages.length && (
                  <>
                    <p>
                      Ative a escuta e diga “James” ou “Jhames”. Depois, fale
                      normalmente. Também pode digitar.
                    </p>
                    <div className={styles.suggestions}>
                      {[
                        "Procure parafusos",
                        "Mostre meu carrinho",
                        "Revisar requisição",
                      ].map((s) => (
                        <button key={s} onClick={() => void send(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {messages.map((m, i) => (
                  <article
                    key={i}
                    className={m.user ? styles.user : styles.answer}
                  >
                    {m.user || (
                      <>
                        <p>{m.answer?.reply}</p>
                        {m.answer?.choices?.map((p) => (
                          <button
                            key={p.code}
                            onClick={() => {
                              setInput(p.code);
                              field.current?.focus();
                            }}
                          >
                            {p.code} · {p.name}
                          </button>
                        ))}
                        {m.answer?.items?.length ? (
                          <details open>
                            <summary>Carrinho revisado</summary>
                            <ul>
                              {m.answer.items.map((p) => (
                                <li key={p.code}>
                                  {p.name} ({p.code}): {p.quantity} {p.unit}.
                                  Embalagem: {p.packSize}. Disponível:{" "}
                                  {p.available}.
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                        {m.answer?.result?.ids && (
                          <p>
                            Protocolos:{" "}
                            {m.answer.result.ids
                              .map((id) => `REQ-${id}`)
                              .join(", ")}
                          </p>
                        )}
                        {m.answer?.dashboard && (
                          <details>
                            <summary>Dados reais autorizados</summary>
                            <p>
                              {m.answer.dashboard.scope} ·{" "}
                              {m.answer.dashboard.period}
                            </p>
                            <ul>
                              {m.answer.dashboard.metrics.map((v) => (
                                <li key={v.id}>
                                  {v.label}: {v.value ?? "Indisponível"}{" "}
                                  {v.unit}
                                  <small> — {v.definition}</small>
                                </li>
                              ))}
                            </ul>
                            <small>
                              Atualizado: {m.answer.dashboard.updatedAt}
                            </small>
                          </details>
                        )}
                        {m.answer?.href && (
                          <button
                            onClick={() => {
                              close();
                              router.push(m.answer!.href!);
                            }}
                          >
                            Abrir dashboard
                          </button>
                        )}
                      </>
                    )}
                  </article>
                ))}
              </div>
              <p className={styles.status} role="status">
                {state === "processing"
                  ? "Entendendo seu pedido… Até 45 segundos."
                  : state === "speaking"
                    ? "Falando. Você pode interromper."
                    : validReview
                      ? "Aguardando sua confirmação explícita."
                      : voice.listening
                        ? "Ouvindo localmente. Diga James ou continue a conversa."
                        : "Pronto. Digite ou ative a escuta."}
              </p>
              {error && (
                <p role="alert" className={styles.error}>
                  {error}
                </p>
              )}
              {validReview && (
                <div className={styles.actions}>
                  <button
                    disabled={state === "processing"}
                    onClick={() => void send("Confirmar requisição", true)}
                  >
                    Confirmar requisição
                  </button>
                  <button
                    disabled={state === "processing"}
                    onClick={() => void send("Cancelar")}
                  >
                    Cancelar envio
                  </button>
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
              >
                <label htmlFor="james-input">Sua pergunta ou correção</label>
                <input
                  ref={field}
                  id="james-input"
                  value={input}
                  maxLength={2000}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={state === "processing"}
                />
                <div className={styles.actions}>
                  <button
                    type="submit"
                    disabled={!input.trim() || state === "processing"}
                  >
                    Enviar
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      voice.listening ? pause() : void voice.start()
                    }
                  >
                    {voice.listening ? "Desligar escuta" : "Ativar escuta"}
                  </button>
                  {voice.installable && (
                    <button type="button" onClick={() => void voice.install()}>
                      Instalar português local
                    </button>
                  )}
                  {state === "processing" && (
                    <button
                      type="button"
                      onClick={() => {
                        pending.current?.abort();
                        pending.current = null;
                        setState("idle");
                        setError(
                          "Consulta interrompida. Se estava enviando, confirme novamente o mesmo resumo para recuperar o resultado sem duplicar.",
                        );
                      }}
                    >
                      Interromper
                    </button>
                  )}
                  {state === "speaking" && (
                    <button
                      type="button"
                      onClick={() => {
                        stopSpeech();
                        setState(validReview ? "confirming" : "idle");
                      }}
                    >
                      Interromper fala
                    </button>
                  )}
                </div>
                <details className={styles.settings}>
                  <summary>Preferências do James</summary>
                  <label>
                    <input
                      type="checkbox"
                      checked={pet.preferences.still}
                      onChange={(e) => pet.update({ still: e.target.checked })}
                    />
                    Ficar parado
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={pet.preferences.quiet}
                      onChange={(e) => pet.update({ quiet: e.target.checked })}
                    />
                    Silenciar dicas
                  </label>
                  <label>
                    Posição preferida
                    <select
                      aria-label="Posição do James"
                      value={pet.preferences.dock}
                      onChange={(e) =>
                        pet.update({ dock: e.target.value as Dock })
                      }
                    >
                      <option value="right">Direita, se houver espaço</option>
                      <option value="left">Esquerda, se houver espaço</option>
                      <option value="inline">
                        Área reservada ao fim da página
                      </option>
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={voice.listening}
                      onChange={(e) =>
                        e.target.checked ? void voice.start() : pause()
                      }
                    />
                    Manter James pronto enquanto uso o site
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      dialog.current?.close();
                      pet.point();
                    }}
                  >
                    Mostrar o próximo controle
                  </button>
                </details>
                <label className={styles.voice}>
                  <input
                    type="checkbox"
                    checked={voiceOutput}
                    onChange={(e) => {
                      setVoiceOutput(e.target.checked);
                      if (!e.target.checked) {
                        stopSpeech();
                        setState(validReview ? "confirming" : "idle");
                      }
                    }}
                  />
                  Ler respostas com voz local
                </label>
                <small>
                  {provider === "nvidia"
                    ? "Seu comando em texto e os itens do carrinho são processados pela NVIDIA."
                    : "O modelo processa o texto no Ollama local."}{" "}
                  Áudio e despertar ficam no dispositivo. Escuta pausa ao
                  ocultar a aba.
                </small>
                {voice.listening && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      dialog.current?.close();
                    }}
                  >
                    Minimizar e manter escuta nesta aba
                  </button>
                )}
              </form>
            </section>
          </>
        )}
      </dialog>
    </div>
  );
}
