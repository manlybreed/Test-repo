"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";

function Blobs() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 800,
          height: 800,
          left: "-20%",
          top: "-25%",
          background: "radial-gradient(circle, rgba(99,102,241,0.14) 0%, transparent 65%)",
          filter: "blur(80px)",
        }}
        animate={{ x: [0, 40, -20, 0], y: [0, -20, 40, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 600,
          height: 600,
          right: "-15%",
          bottom: "-20%",
          background: "radial-gradient(circle, rgba(42,82,160,0.12) 0%, transparent 65%)",
          filter: "blur(90px)",
        }}
        animate={{ x: [0, -30, 20, 0], y: [0, 25, -35, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: "easeInOut", delay: 5 }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 350,
          height: 350,
          left: "55%",
          top: "35%",
          background: "radial-gradient(circle, rgba(240,180,41,0.06) 0%, transparent 70%)",
          filter: "blur(60px)",
        }}
        animate={{ scale: [1, 1.3, 0.85, 1], opacity: [0.5, 1, 0.6, 0.5] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut", delay: 3 }}
      />
    </div>
  );
}

function GridOverlay() {
  return (
    <div
      className="pointer-events-none fixed inset-0"
      style={{
        backgroundImage:
          "linear-gradient(rgba(99,102,241,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.035) 1px, transparent 1px)",
        backgroundSize: "80px 80px",
      }}
    />
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("ceo@thebluridge.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) { setError("Invalid credentials"); return; }
    router.push("/ceo");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative">
      <Blobs />
      <GridOverlay />

      <div className="relative w-full max-w-md z-10">
        {/* Logo */}
        <motion.div
          className="flex flex-col items-center mb-10"
          initial={{ opacity: 0, y: -28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
        >
          <Image
            src="/brand/logo.png"
            alt="The BluRidge"
            width={210}
            height={65}
            priority
            style={{ filter: "brightness(0) invert(1)", opacity: 0.9 }}
          />
          <motion.p
            className="mt-3 text-[0.62rem] tracking-[0.3em] uppercase font-medium"
            style={{ color: "var(--text-dim)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45, duration: 0.6 }}
          >
            CEO Command Center
          </motion.p>
        </motion.div>

        {/* Card */}
        <motion.div
          className="panel-glass p-8 space-y-5"
          style={{ boxShadow: "0 32px 80px rgba(0,0,0,0.5), 0 0 60px rgba(99,102,241,0.06)" }}
          initial={{ opacity: 0, y: 36, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.65, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <div>
            <p className="text-xl font-semibold tracking-tight mb-1">Sign in</p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Authorised personnel only.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <motion.p
                className="text-xs px-3 py-2 rounded-md"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", color: "#fca5a5" }}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
              >
                {error}
              </motion.p>
            )}

            <button
              type="submit"
              className="btn btn-primary w-full mt-2"
              disabled={loading}
              style={{ height: 46, fontSize: "0.9rem" }}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="loading-spin" /> Authenticating…
                </span>
              ) : "Enter Command Center"}
            </button>
          </form>
        </motion.div>

        <motion.p
          className="text-center text-xs mt-6"
          style={{ color: "var(--text-dim)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
        >
          The BluRidge · PM KUSUM Finance Advisory · New Delhi
        </motion.p>
      </div>
    </div>
  );
}
