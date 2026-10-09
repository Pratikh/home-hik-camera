"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Application-level focus mode.
 *
 * When a camera is focused the shell hides its header, sidebar and navigation,
 * and the focused camera fills the viewport. This is purely an in-app state
 * change — the browser Fullscreen API is deliberately not involved, so the
 * window, the WebRTC session and the MediaMTX paths are all untouched.
 */
type CameraFocusValue = {
  isFocused: boolean;
  setFocused: (focused: boolean) => void;
};

const CameraFocusContext = createContext<CameraFocusValue>({
  isFocused: false,
  setFocused: () => undefined,
});

export function CameraFocusProvider({ children }: { children: ReactNode }) {
  const [isFocused, setFocused] = useState(false);
  const value = useMemo(() => ({ isFocused, setFocused }), [isFocused]);
  return <CameraFocusContext.Provider value={value}>{children}</CameraFocusContext.Provider>;
}

export function useCameraFocus(): CameraFocusValue {
  return useContext(CameraFocusContext);
}
