"use client";

import { useRef } from "react";
import { Camera } from "lucide-react";
import { BATTING_STYLES, BOWLING_STYLES, ROLES } from "@/lib/types";
import { Avatar, Field, Input, Select } from "./ui";

export type PlayerFormValues = {
  name: string;
  phone: string;
  role: string;
  batting_style: string;
  bowling_style: string;
  age: string;
  city: string;
  photo_url: string;
};

export const emptyPlayerForm: PlayerFormValues = {
  name: "", phone: "", role: "", batting_style: "", bowling_style: "", age: "", city: "", photo_url: "",
};

// Shared by the organiser's player form and the public registration page
export function PlayerFields({
  values,
  onChange,
  photoPreview,
  onPhoto,
}: {
  values: PlayerFormValues;
  onChange: (v: PlayerFormValues) => void;
  photoPreview?: string | null;
  onPhoto: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (key: keyof PlayerFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...values, [key]: e.target.value });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => fileInput.current?.click()} className="group relative rounded-full">
          <Avatar name={values.name || "?"} src={photoPreview ?? values.photo_url} size={72} />
          <span className="absolute -bottom-1 -right-1 rounded-full border-2 border-white bg-emerald-600 p-1.5 text-white">
            <Camera className="size-3.5" />
          </span>
        </button>
        <div className="text-sm">
          <p className="font-medium text-slate-700">Player photo</p>
          <p className="text-slate-500">A clear face photo looks great on the big screen.</p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0])}
        />
      </div>

      <Field label="Full name">
        <Input value={values.name} onChange={set("name")} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mobile number">
          <Input type="tel" inputMode="tel" value={values.phone} onChange={set("phone")} placeholder="10-digit mobile" />
        </Field>
        <Field label="City / village">
          <Input value={values.city} onChange={set("city")} />
        </Field>
        <Field label="Playing role">
          <Select value={values.role} onChange={set("role")}>
            <option value="">Select role</option>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="Age">
          <Input type="number" min={8} max={80} value={values.age} onChange={set("age")} />
        </Field>
        <Field label="Batting style">
          <Select value={values.batting_style} onChange={set("batting_style")}>
            <option value="">Select</option>
            {BATTING_STYLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="Bowling style">
          <Select value={values.bowling_style} onChange={set("bowling_style")}>
            <option value="">Select</option>
            {BOWLING_STYLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}
