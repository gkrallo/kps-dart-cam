import { useEffect, useRef, useState } from 'react';
import { RemoteReplica } from '../remote/replica';
import type { Transport } from '../remote/transport';

/**
 * Fjärrskärmens kopia av matchen som React-tillstånd. En RemoteReplica per
 * sidladdning; den läser den senast sparade bilden direkt, så resultattavlan
 * syns redan innan någon parkoppling gjorts (omladdning mitt i en leg).
 */
export function useRemoteReplica() {
  const ref = useRef<RemoteReplica | null>(null);
  if (ref.current === null) ref.current = new RemoteReplica();
  const replica = ref.current;
  const [, setTick] = useState(0);

  useEffect(() => replica.subscribe(() => setTick((n) => n + 1)), [replica]);

  const detachRef = useRef<(() => void) | null>(null);
  const connect = (t: Transport) => {
    detachRef.current?.();
    detachRef.current = replica.attach(t);
  };

  return { replica, connect };
}
