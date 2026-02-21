export type SaveQueueStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

type StatusPayload = {
  status: SaveQueueStatus;
  error?: unknown;
};

type EnqueueOptions = {
  immediate?: boolean;
};

type SaveQueueOptions<TPayload> = {
  debounceMs?: number;
  save: (payload: TPayload) => Promise<void>;
  onStatus?: (payload: StatusPayload) => void;
};

export function createSaveQueue<TPayload>(options: SaveQueueOptions<TPayload>) {
  const debounceMs = options.debounceMs ?? 600;

  let latestPayload: TPayload | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let disposed = false;

  const emit = (status: SaveQueueStatus, error?: unknown) => {
    options.onStatus?.({ status, error });
  };

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const drain = async () => {
    if (disposed || running || !latestPayload) return;

    running = true;

    while (!disposed && latestPayload) {
      const payload = latestPayload;
      latestPayload = null;
      emit("saving");

      try {
        await options.save(payload);
        if (latestPayload) {
          emit("unsaved");
        } else {
          emit("saved");
        }
      } catch (error) {
        emit("error", error);
      }
    }

    running = false;
  };

  const enqueue = (payload: TPayload, opts: EnqueueOptions = {}) => {
    if (disposed) return;
    latestPayload = payload;
    emit("unsaved");

    if (opts.immediate) {
      clearTimer();
      void drain();
      return;
    }

    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, debounceMs);
  };

  const flush = async () => {
    if (disposed) return;
    clearTimer();
    await drain();
  };

  const dispose = () => {
    disposed = true;
    clearTimer();
    latestPayload = null;
  };

  return {
    enqueue,
    flush,
    dispose,
  };
}
