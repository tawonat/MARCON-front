"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { wakeCommand } from "@/lib/james-voice";
type Recognition = {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
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
  const [installable, setInstallable] = useState(false);
  const enabled = useRef(false),
    session = useRef(0),
    conversation = useRef(0),
    rec = useRef<Recognition | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    audio = useRef<AudioContext | null>(null);
  const callbacks = useRef({ onCommand, onWake, onError });
  const restart = useRef<(() => void) | null>(null);
  const suspend = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (rec.current) {
      rec.current.onresult = null;
      rec.current.onend = null;
      rec.current.onerror = null;
      rec.current.abort();
      rec.current = null;
    }
  }, []);
  const resume = useCallback(() => {
    if (enabled.current && !rec.current) restart.current?.();
  }, []);
  useEffect(() => {
    callbacks.current = { onCommand, onWake, onError };
  }, [onCommand, onWake, onError]);
  const stop = useCallback(() => {
    session.current++;
    enabled.current = false;
    restart.current = null;
    setListening(false);
    conversation.current = 0;
    if (timer.current) clearTimeout(timer.current);
    if (rec.current) {
      rec.current.onend = null;
      rec.current.onresult = null;
      rec.current.onerror = null;
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
  const start = async () => {
    stop();
    const generation = session.current;
    const C = constructor();
    if (!C || !("processLocally" in C.prototype) || !C.available) {
      callbacks.current.onError(
        "Escuta local indisponível neste navegador. Use texto e botões; nenhum áudio foi enviado.",
      );
      return;
    }
    try {
      audio.current = new AudioContext();
      await audio.current.resume();
      const availability = await C.available({
        langs: ["pt-BR"],
        processLocally: true,
      });
      if (generation !== session.current) return;
      if (availability !== "available") {
        setInstallable(availability === "downloadable");
        stop();
        callbacks.current.onError(
          "Instale o pacote local de português, se disponível, ou use texto.",
        );
        return;
      }
      enabled.current = true;
      setListening(true);
      let retries = 0;
      const run = () => {
        if (!enabled.current || document.hidden) return;
        const r = new C();
        rec.current = r;
        r.processLocally = true;
        r.lang = "pt-BR";
        r.continuous = true;
        r.interimResults = false;
        r.onresult = (e) => {
          retries = 0;
          for (let i = e.resultIndex; i < e.results.length; i++)
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
        };
        r.onerror = (e) => {
          if (e.error === "no-speech") return;
          stop();
          callbacks.current.onError(
            "Falha no microfone (" +
              e.error +
              "). Verifique a permissão ou use texto.",
          );
        };
        r.onend = () => {
          if (enabled.current && ++retries <= 3)
            timer.current = setTimeout(run, 500);
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
      stop();
      callbacks.current.onError(
        "Microfone ou pacote local indisponível. Use texto.",
      );
    }
  };
  const install = async () => {
    try {
      const C = constructor();
      if (await C?.install?.({ langs: ["pt-BR"], processLocally: true })) {
        setInstallable(false);
        callbacks.current.onError("Pacote instalado. Clique em Ativar escuta.");
      } else
        callbacks.current.onError(
          "Português local indisponível neste navegador.",
        );
    } catch {
      callbacks.current.onError("Não foi possível instalar o pacote local.");
    }
  };
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", stop);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", stop);
    };
  }, [stop]);
  return { listening, start, stop, install, installable, suspend, resume };
}
