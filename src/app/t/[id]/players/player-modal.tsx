"use client";

import { useState } from "react";
import { PlayerFields, emptyPlayerForm, type PlayerFormValues } from "@/components/player-fields";
import { toast } from "@/components/toast";
import { Button, Field, Input, Modal } from "@/components/ui";
import { errorMessage } from "@/lib/format";
import { uploadPhoto } from "@/lib/image";
import { supabase } from "@/lib/supabase";
import type { Player, Tournament } from "@/lib/types";

export function PlayerModal({
  tournament,
  player,
  phone,
  onClose,
  onSaved,
}: {
  tournament: Tournament;
  player: Player | null; // null = new player
  phone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<PlayerFormValues>(() =>
    player
      ? {
          name: player.name,
          phone,
          role: player.role ?? "",
          batting_style: player.batting_style ?? "",
          bowling_style: player.bowling_style ?? "",
          age: player.age?.toString() ?? "",
          city: player.city ?? "",
          photo_url: player.photo_url ?? "",
        }
      : emptyPlayerForm,
  );
  const [basePrice, setBasePrice] = useState(String(player?.base_price ?? tournament.base_price));
  const [category, setCategory] = useState(player?.category ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function pickPhoto(file: File) {
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const photo_url = photo ? await uploadPhoto(tournament.id, photo) : values.photo_url || null;
      const row = {
        name: values.name.trim(),
        role: values.role || null,
        batting_style: values.batting_style || null,
        bowling_style: values.bowling_style || null,
        age: values.age ? Number(values.age) : null,
        city: values.city.trim() || null,
        photo_url,
        category: category.trim() || null,
        base_price: Number(basePrice),
      };
      let id = player?.id;
      if (id) {
        const { error } = await supabase.from("players").update(row).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("players")
          .insert({ ...row, tournament_id: tournament.id, source: "manual" })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
      }
      const { error } = await supabase
        .from("player_contacts")
        .upsert({ player_id: id, tournament_id: tournament.id, phone: values.phone.trim() || null });
      if (error) throw error;
      toast(player ? "Player updated" : "Player added", "success");
      onSaved();
      onClose();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={player ? "Edit player" : "Add player"}>
      <form onSubmit={onSubmit} className="space-y-4">
        <PlayerFields values={values} onChange={setValues} photoPreview={preview} onPhoto={pickPhoto} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Base price (Rs)">
            <Input type="number" min={1} value={basePrice} onChange={(e) => setBasePrice(e.target.value)} required />
          </Field>
          <Field label="Category" hint="Optional, e.g. A / B / Icon">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {player ? "Save changes" : "Add player"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
