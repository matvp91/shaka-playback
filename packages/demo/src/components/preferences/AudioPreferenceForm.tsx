import { zodResolver } from "@hookform/resolvers/zod";
import type { Player } from "cmaf-lite";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { OptionalInput } from "../form/OptionalInput";
import { Button } from "../ui/button";
import { Label } from "../ui/label";

const schema = z.object({
  bandwidth: z.coerce.number().optional(),
  codec: z.string().optional(),
});

type AudioPreferenceFormProps = {
  player: Player;
};

// biome-ignore lint/correctness/noUnusedFunctionParameters: Intended
export function AudioPreferenceForm({ player }: AudioPreferenceFormProps) {
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(schema),
  });

  // biome-ignore lint/correctness/noUnusedFunctionParameters: Intended
  function onSubmit(values: z.output<typeof schema>) {
    // TODO(matvp): setStreamPreference is gone.
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-2 w-full">
      <h3>audio</h3>
      <div>
        <Label htmlFor="audio-bandwidth">bandwidth</Label>
        <OptionalInput
          id="audio-bandwidth"
          type="number"
          name="bandwidth"
          register={register}
        />
      </div>
      <div>
        <Label htmlFor="audio-codec">codec</Label>
        <OptionalInput
          id="audio-codec"
          type="number"
          name="codec"
          register={register}
        />
      </div>
      <Button type="submit">Set audio preference</Button>
    </form>
  );
}
