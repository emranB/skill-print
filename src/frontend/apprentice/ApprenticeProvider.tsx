import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useApp } from "../app/AppContext";
import type { ApprenticeGateway } from "./ApprenticeGateway";
import { ElevenLabsGateway } from "./ElevenLabsGateway";
import { MockApprenticeGateway } from "./MockApprenticeGateway";

const Ctx = createContext<ApprenticeGateway | null>(null);

export function ApprenticeProvider({ children }: { children: ReactNode }) {
  const { apprenticeMode } = useApp();
  const gateway = useMemo<ApprenticeGateway>(() => {
    return apprenticeMode === "elevenlabs" ? new ElevenLabsGateway() : new MockApprenticeGateway();
  }, [apprenticeMode]);

  return <Ctx.Provider value={gateway}>{children}</Ctx.Provider>;
}

export function useApprentice(): ApprenticeGateway {
  const gateway = useContext(Ctx);
  if (!gateway) throw new Error("useApprentice requires ApprenticeProvider");
  return gateway;
}
