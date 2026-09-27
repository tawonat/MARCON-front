"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { wakeCommand } from "@/lib/james-voice";
type Recognition = {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onsoundend: (() => void) | null;
  onresult:
    | ((e: {
        resultIndex: number;
        results: {
          length: number;
          [n: number]: {
            isFinal: boolean;
            [n: number]: { transcript: string };
          };
        };
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};
type Constructor = {
  new (): Recognition;
  available?: (p: {
    langs: string[];
    processLocally: boolean;
  }) => Promise<string>;
  install?: (p: {
    langs: string[];
    processLocally: boolean;
  }) => Promise<boolean>;
};
export function useJamesVoice(
  onCommand: (text: string) => void,
  onWake: () => void,
  onError: (message: string) => void,
) {
  const [listening, setListening] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [installable, setInstallable] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [browserFallback, setBrowserFallback] = useState(false);
  const [mode, setMode] = useState<"local" | "browser">("local");
  const [hidden, setHidden] = useState(false);
  const enabled = useRef(false),
    suspended = useRef(false),
    session = useRef(0),
    conversation = useRef(0),
    rec = useRef<Recognition | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    audio = useRef<AudioContext | null>(null);
  const callbacks = useRef({ onCommand, onWake, onError });
  const restart = useRef<(() => void) | null>(null);
  const detach = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCapturing(false);
    setHearing(false);
    if (rec.current) {
      rec.current.onresult = null;
      rec.current.onend = null;
      rec.current.onerror = null;
      rec.current.onstart = null;
      rec.current.onsoundstart = null;
      rec.current.onsoundend = null;
      rec.current.abort();
      rec.current = null;
    }
  }, []);
  const suspend = useCallback(() => {
    suspended.current = true;
    detach();
  }, [detach]);
  const resume = useCallback(() => {
    suspended.current = false;
    if (enabled.current && !rec.current) restart.current?.();
  }, []);
  useEffect(() => {
    callbacks.current = { onCommand, onWake, onError };
  }, [onCommand, onWake, onError]);
  const stop = useCallback(() => {
    session.current++;
    enabled.current = false;
    suspended.current = false;
    restart.current = null;
    setListening(false);
    setCapturing(false);
    setHearing(false);
    setTranscript("");
    setInstalling(false);
    conversation.current = 0;
    if (timer.current) clearTimeout(timer.current);
    if (rec.current) {
      rec.current.onend = null;
      rec.current.onresult = null;
      rec.current.onerror = null;
      rec.current.onstart = null;
      rec.current.onsoundstart = null;
      rec.current.onsoundend = null;
      rec.current.abort();
      rec.current = null;
    }
    void audio.current?.close();
    audio.current = null;
  }, []);
  const constructor = () => {
    const w = window as typeof window & {
      SpeechRecognition?: Constructor;
      webkitSpeechRecognition?: Constructor;
    };
    return w.SpeechRecognition || w.webkitSpeechRecognition;
  };
  const start = async (selected: "local" | "browser" = "local") => {
    stop();
    setMode(selected);
    setInstallable(false);
    setBrowserFallback(false);
    callbacks.current.onError("");
    const generation = session.current;
    const C = constructor();
    if (
      !C ||
      (selected === "local" &&
        (!("processLocally" in C.prototype) || !C.available))
    ) {
      setBrowserFallback(!!C);
      callbacks.current.onError(
        C
          ? "Escuta local indisponível neste navegador. Você pode escolher a voz online do navegador abaixo; nenhum áudio foi enviado."
          : "Escuta local indisponível neste navegador. Use um navegador com reconhecimento de voz ou continue por texto.",
      );
      return;
    }
    try {
      audio.current = new AudioContext();
      await audio.current.resume();
      const availability =
        selected === "browser"
          ? "available"
          : await C.available!({
              langs: ["pt-BR"],
              processLocally: true,
            });
      if (generation !== session.current) return;
      if (availability !== "available") {
        setInstallable(
          ["downloadable", "downloading"].includes(availability) && !!C.install,
        );
        setBrowserFallback(true);
        stop();
        callbacks.current.onError(
          availability === "unavailable"
            ? "Este navegador não oferece português local. Escolha a voz online abaixo ou use texto. Não há pacote local para instalar."
            : availability === "downloading"
              ? "O pacote de português está sendo baixado. Clique em Instalar português local para verificar e iniciar quando terminar."
              : "O pacote local de português precisa ser instalado. Clique em Instalar português local; James iniciará a escuta após a instalação.",
        );
        return;
      }
      enabled.current = true;
      setListening(true);
      let retries = 0;
      const run = () => {
        if (
          !enabled.current ||
          suspended.current ||
          document.hidden ||
          rec.current
        )
          return;
        if (timer.current) clearTimeout(timer.current);
        let startedAt = Date.now(),
          silence = false;
        const r = new C();
        rec.current = r;
        r.processLocally = selected === "local";
        r.lang = "pt-BR";
        r.continuous = true;
        r.interimResults = true;
        r.onstart = () => {
          startedAt = Date.now();
          setCapturing(true);
        };
        r.onsoundstart = () => setHearing(true);
        r.onsoundend = () => setHearing(false);
        r.onresult = (e) => {
          retries = 0;
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const partial = e.results[i][0].transcript.trim();
            // Do not expose ambient conversation unless addressed to James.
            if (
              Date.now() < conversation.current ||
              wakeCommand(partial) !== null
            )
              setTranscript(partial);
            if (e.results[i].isFinal) {
              const text = e.results[i][0].transcript.trim();
              const command = wakeCommand(text);
              if (command !== null) {
                conversation.current = Date.now() + 90000;
                callbacks.current.onWake();
                const context = audio.current;
                if (context && context.state === "running") {
                  const tone = context.createOscillator(),
                    gain = context.createGain();
                  tone.connect(gain);
                  gain.connect(context.destination);
                  tone.frequency.value = 660;
                  gain.gain.setValueAtTime(0.035, context.currentTime);
                  gain.gain.exponentialRampToValueAtTime(
                    0.001,
                    context.currentTime + 0.14,
                  );
                  tone.start();
                  tone.stop(context.currentTime + 0.15);
                  tone.onended = () => {
                    tone.disconnect();
                    gain.disconnect();
                  };
                }
                if (command) callbacks.current.onCommand(command);
              } else if (Date.now() < conversation.current) {
                conversation.current = Date.now() + 90000;
                callbacks.current.onCommand(text);
              }
            }
          }
        };
        r.onerror = (e) => {
          if (e.error === "no-speech") {
            silence = true;
            return;
          }
          stop();
          callbacks.current.onError(
            "Falha no microfone (" +
              e.error +
              "). Verifique a permissão ou use texto.",
          );
        };
        r.onend = () => {
          rec.current = null;
          setCapturing(false);
          setHearing(false);
          // Normal silence/session limits are not failures. Retry while enabled.
          // Rapid unexplained ends are bounded to avoid a permission/restart loop.
          retries = silence || Date.now() - startedAt >= 1500 ? 0 : retries + 1;
          if (enabled.current && retries <= 5)
            timer.current = setTimeout(run, Math.min(500 * 2 ** retries, 8000));
          else if (enabled.current) {
            stop();
            callbacks.current.onError(
              "Escuta pausada pelo navegador. Ative novamente ou use texto.",
            );
          }
        };
        try {
          r.start();
        } catch {
          stop();
          callbacks.current.onError(
            "Não foi possível iniciar o microfone. Use texto.",
          );
        }
      };
      restart.current = run;
      run();
    } catch {
      if (generation !== session.current) return;
      stop();
      callbacks.current.onError(
        "Microfone ou pacote local indisponível. Use texto.",
      );
    }
  };
  const install = async () => {
    const generation = session.current;
    setInstalling(true);
    callbacks.current.onError("");
    try {
      const C = constructor();
      const installed = await C?.install?.({
        langs: ["pt-BR"],
        processLocally: true,
      });
      if (generation !== session.current) return;
      if (installed) {
        setInstallable(false);
        await start("local");
      } else
        callbacks.current.onError(
          "Português local indisponível neste navegador.",
        );
    } catch {
      if (generation === session.current)
        callbacks.current.onError(
          "Não foi possível instalar o pacote local. Tente novamente ou escolha voz online.",
        );
    } finally {
      if (generation === session.current) setInstalling(false);
    }
  };
  useEffect(() => {
    const visibility = () => {
      setHidden(document.hidden);
      if (document.hidden) detach();
      else if (enabled.current && !suspended.current) restart.current?.();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", stop);
    };
  }, [stop, detach]);
  return {
    listening,
    capturing,
    hearing,
    transcript,
    start,
    stop,
    install,
    installable,
    installing,
    browserFallback,
    mode,
    hidden,
    suspend,
    resume,
  };
}
