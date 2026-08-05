"use client";

import { useEffect, useState } from "react";

/**
 * Time-of-day greeting for the signed-in account.
 *
 * Resolved after mount, never during render: the server clock is UTC, so a
 * server-rendered greeting would tell an Australian rep "good evening" over
 * their morning coffee — and mismatch on hydration. The neutral "Welcome back"
 * stands in for that first paint, so only the greeting word settles.
 */
export function useGreeting(): string {
  const [greeting, setGreeting] = useState("Welcome back");

  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
  }, []);

  return greeting;
}
