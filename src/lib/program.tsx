import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApi } from "./api";
import { useAuth } from "./auth";
import { safeStorage } from "./utils";

export interface ProgramLite { id: string; name: string; status: string; budgetCents: number; issuedCents: number; allocatedCents: number; redeemedCents: number; outstandingClaimsCents: number; startDate: string; endDate: string; emergencyType: string; region: string; communityCount: number; residentCount: number; restrictHomeCommunity: boolean; categories: string[] }
interface Ctx { programs: ProgramLite[]; program: ProgramLite | null; programId: string | null; setProgramId: (id: string) => void; reload: () => void; loading: boolean }
const PCtx = createContext<Ctx>(null as never);
const store = safeStorage();

export function ProgramProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data, loading, reload } = useApi<{ programs: ProgramLite[] }>(user?.role === "coordinator" ? "/api/programs/lite" : null);
  const [selected, setSelected] = useState<string | null>(() => store.get("relay.program"));
  const programs = data?.programs ?? [];
  const program = programs.find((p) => p.id === selected) ?? programs.find((p) => p.status === "active") ?? programs[0] ?? null;
  useEffect(() => { if (program && program.id !== selected) setSelected(program.id); }, [program, selected]);
  const setProgramId = useCallback((id: string) => { setSelected(id); store.set("relay.program", id); }, []);
  const value = useMemo(() => ({ programs, program, programId: program?.id ?? null, setProgramId, reload, loading }), [programs, program, setProgramId, reload, loading]);
  return <PCtx.Provider value={value}>{children}</PCtx.Provider>;
}
export const useProgram = () => useContext(PCtx);
