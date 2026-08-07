"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  UserIcon,
  MailIcon,
  IdIcon,
  BuildingIcon,
  TagIcon,
  UsersIcon,
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  GraduationCapIcon,
  BriefcaseIcon,
  SpinnerIcon,
} from "@/components/ui/icons";

type FormRole = "STUDENT" | "SUPERVISOR";

export default function SignupPage() {
  const router = useRouter();
  const [role, setRole] = useState<FormRole>("STUDENT");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [studentId, setStudentId] = useState("");
  const [department, setDepartment] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [expertise, setExpertise] = useState("");
  const [capacity, setCapacity] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          studentId,
          department,
          role,
          researchInterests: expertise
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          maxLoad: capacity,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create account.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Get started"
      title="Create your account"
      subtitle="Register as a student or a supervisor."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {/* Role picker */}
      <div className="mb-5 grid grid-cols-2 gap-2">
        {(
          [
            { value: "STUDENT", label: "Student", icon: GraduationCapIcon },
            { value: "SUPERVISOR", label: "Supervisor", icon: BriefcaseIcon },
          ] as const
        ).map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setRole(value)}
            className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
              role === value
                ? "border-brand bg-brand text-brand-foreground"
                : "border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
        <Input
          label="Full name"
          name="name"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Doe"
          icon={<UserIcon />}
        />
        <Input
          label="University email"
          type="email"
          name="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@bracu.ac.bd"
          icon={<MailIcon />}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={role === "STUDENT" ? "Student ID" : "Faculty ID"}
            name="studentId"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            placeholder="23101266"
            icon={<IdIcon />}
          />
          <Input
            label="Department"
            name="department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="CSE"
            icon={<BuildingIcon />}
          />
        </div>

        {role === "SUPERVISOR" && (
          <div className="space-y-4 rounded-lg border border-dashed border-border bg-background/60 p-3.5">
            <Input
              label="Areas of expertise"
              name="expertise"
              value={expertise}
              onChange={(e) => setExpertise(e.target.value)}
              placeholder="NLP, Distributed Systems, HCI"
              icon={<TagIcon />}
            />
            <Input
              label="Current supervision capacity"
              type="number"
              name="capacity"
              min={1}
              max={20}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              icon={<UsersIcon />}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Password"
            type={showPassword ? "text" : "password"}
            name="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            icon={<LockIcon />}
            rightSlot={
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="text-muted transition-colors hover:text-foreground"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            }
          />
          <Input
            label="Confirm password"
            type={showConfirm ? "text" : "password"}
            name="confirmPassword"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            icon={<LockIcon />}
            rightSlot={
              <button
                type="button"
                onClick={() => setShowConfirm((s) => !s)}
                className="text-muted transition-colors hover:text-foreground"
                tabIndex={-1}
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            }
          />
        </div>

        {error && (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-foreground">{error}</p>
        )}

        <Button type="submit" disabled={loading} className="w-full">
          {loading && <SpinnerIcon />}
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
