"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../login.module.css";

export function FaceCameraTest({ onCancel }: { onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    const video = videoRef.current;
    async function openCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Câmera indisponível neste navegador.");
        const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        if (!active) { camera.getTracks().forEach((track) => track.stop()); return; }
        stream = camera;
        if (video) {
          video.srcObject = camera;
          await video.play();
        }
      } catch {
        if (active) setError("Não foi possível abrir a câmera. Confira a permissão e tente novamente.");
      }
    }
    void openCamera();
    return () => {
      active = false;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, []);

  function testCapture() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) { setError("Aguarde a câmera iniciar."); return; }
    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    canvas.getContext("2d")?.drawImage(video, 0, 0, 1, 1);
    setError("");
    setMessage("Câmera funcionando. Nenhuma imagem foi enviada ou salva.");
  }

  return <section className={styles.faceTest} aria-labelledby="face-test-title">
    <h2 id="face-test-title">Teste da câmera facial</h2>
    <p>Confira a câmera antes da futura identificação facial. Este teste não entra na conta.</p>
    <video ref={videoRef} autoPlay muted playsInline aria-label="Prévia da câmera" />
    {error && <p role="alert" className={styles.faceTestError}>{error}</p>}
    {message && <p role="status">{message}</p>}
    <div className={styles.faceTestActions}>
      <button type="button" onClick={testCapture}>Testar câmera</button>
      <button type="button" onClick={onCancel}>Voltar ao login</button>
    </div>
  </section>;
}
