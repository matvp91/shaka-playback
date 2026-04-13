import { zodResolver } from "@hookform/resolvers/zod";
import type { Player } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { OptionalInput } from "../form/OptionalInput";
import { Button } from "../ui/button";
import { Label } from "../ui/label";

const schema = z.object({
  width: z.coerce.number().optional(),
  height: z.coerce.number().optional(),
  bandwidth: z.coerce.number().optional(),
  codec: z.string().optional(),
});

type VideoPreferenceFormProps = {
  player: Player;
};

export function VideoPreferenceForm({ player }: VideoPreferenceFormProps) {
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(schema),
  });

  function onSubmit(values: z.output<typeof schema>) {
    player.setStreamPreference(
      {
        type: MediaType.VIDEO,
        ...values,
      },
      true,
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
      <h3>video</h3>
      <div>
        <Label htmlFor="video-width">width</Label>
        <OptionalInput
          id="video-width"
          type="number"
          name="width"
          register={register}
        />
      </div>
      <div>
        <Label htmlFor="video-height">height</Label>
        <OptionalInput
          id="video-height"
          type="number"
          name="height"
          register={register}
        />
      </div>
      <div>
        <Label htmlFor="video-bandwidth">bandwidth</Label>
        <OptionalInput
          id="video-bandwidth"
          type="number"
          name="bandwidth"
          register={register}
        />
      </div>
      <div>
        <Label htmlFor="video-codec">codec</Label>
        <OptionalInput
          id="video-codec"
          type="text"
          name="codec"
          register={register}
        />
      </div>
      <Button type="submit">Set video preference</Button>
    </form>
  );
}
