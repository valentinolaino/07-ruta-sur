"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EnVivo({ soloPorEvento = true }) {
  const router = useRouter();

  useEffect(() => {
    const es = new EventSource("/api/en-vivo");
    es.addEventListener("open", () => {});
    es.addEventListener("cambio", () => {
      router.refresh();
    });
    // Respaldo: si no llega 'cambio', refresca igual con el ping de 15 s
    es.addEventListener("ping", () => {
      if (!soloPorEvento) router.refresh();
    });
    es.onerror = () => {};
    return () => es.close();
  }, [router, soloPorEvento]);

  return null;
}
