"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOperatorAddress } from "@/hooks/useAuth";
import {
  fetchNotifications,
  markNotificationsRead,
  clearNotifications,
  playNotificationChime,
  type AppNotification,
} from "@/lib/notifications";
import { playWin } from "@/lib/sounds";

const POLL_MS = 20_000;

/// Polls the operator notification feed, tracks unread count, and plays a
/// chime the first time a never-seen notification appears. Only active when
/// signed in. The chime is suppressed on the very first load so a fresh
/// session doesn't blast every backlog item at once.
export function useNotifications() {
  const { isSignedIn } = useOperatorAddress();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const seenIds = useRef<Set<number>>(new Set());
  const primed = useRef(false);
  const soundOn = useRef(true);

  const refresh = useCallback(async () => {
    if (!isSignedIn) return;
    const feed = await fetchNotifications();
    setItems(feed.items);
    setUnread(feed.unread);

    const fresh = feed.items.filter((n) => !seenIds.current.has(n.id));
    for (const n of feed.items) seenIds.current.add(n.id);
    // First poll just primes the seen-set; later polls sound on anything new.
    // A win gets the triumphant flourish; everything else the standard chime.
    if (primed.current && soundOn.current) {
      const freshUnread = fresh.filter((n) => !n.read);
      if (freshUnread.some((n) => n.kind === "contest_win" || n.kind === "challenge_win")) {
        playWin();
      } else if (freshUnread.length > 0) {
        playNotificationChime();
      }
    }
    primed.current = true;
  }, [isSignedIn]);

  useEffect(() => {
    if (!isSignedIn) {
      setItems([]);
      setUnread(0);
      seenIds.current.clear();
      primed.current = false;
      return;
    }
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [isSignedIn, refresh]);

  const markAllRead = useCallback(async () => {
    if (unread === 0) return;
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    await markNotificationsRead();
  }, [unread]);

  const clearAll = useCallback(async () => {
    setItems([]);
    setUnread(0);
    seenIds.current.clear();
    await clearNotifications();
  }, []);

  const setSound = useCallback((on: boolean) => {
    soundOn.current = on;
  }, []);

  return { items, unread, refresh, markAllRead, clearAll, setSound, isSignedIn };
}
