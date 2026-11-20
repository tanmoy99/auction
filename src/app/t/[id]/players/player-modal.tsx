"use client";

import { useState } from "react";
import { PlayerFields, emptyPlayerForm, type PlayerFormValues } from "@/components/player-fields";
import { toast } from "@/components/toast";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { mobileKey } from "@/lib/config";
import { normaliseCategory } from "@/lib/fields";
import { errorMessage } from "@/lib/format";
import { uploadPhoto } from "@/lib/image";
import { supabase } from "@/lib/supabase";
import { ORGANISER_CATEGORIES as CATEGORY_SUGGESTIONS, type Player, type Tournament } from "@/lib/types";

export function PlayerModal({
  tournament,
  player,
  phone,
  takenBy,
  onClose,
  onSaved,
}: {
  tournament: Tournament;
  player: Player | null; // null = new player
  phone: string;
  takenBy?: (mobile: string) => string | undefined; // name of another player in this tournament with this mobile
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
  // Locked to the category list. An old category is matched to the list when possible (U-19 -> Under 19 player);
  // otherwise the organiser has to choose one before saving.
  const oldCategory = player?.category ?? null;
  const [category, setCategory] = useState<string>(() => normaliseCategory(oldCategory) ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function pickPhoto(file: File) {
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const mobile = mobileKey(values.phone);
    if (values.phone.trim() && !mobile) return toast("Enter a 10-digit Indian mobile number, or leave it empty", "error");
    const other = mobile ? takenBy?.(mobile) : undefined;
    if (other) return toast(`This mobile number is already used by ${other} in this tournament`, "error");
    if (!category) return toast("Choose a player category", "error");
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
        category,
        base_price: Number(basePrice),
      };
      const { error } = await supabase.rpc("save_player_contact", {
        p_tournament: tournament.id, p_player: player?.id ?? null, p_data: row, p_phone: values.phone.trim() || null,
      });
      if (error) throw error;
      toast(player ? "Player updated" : "Player added", "success");
      onSaved();
      onClose();
    } catch (err) {
      const message = errorMessage(err);
      toast(/contacts_tournament_mobile_unique|duplicate key/.test(message) ? "This mobile number is already used by another player in this tournament" : message, "error");
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
          <Field
            label="Category *"
            hint={
              oldCategory && oldCategory !== category && !normaliseCategory(oldCategory)
                ? `Old category "${oldCategory}" is not in the list. Choose one.`
                : "The auction can run one category at a time."
            }
          >
            <Select value={category} onChange={(e) => setCategory(e.target.value)} required>
              <option value="">Select category</option>
              {CATEGORY_SUGGESTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
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
