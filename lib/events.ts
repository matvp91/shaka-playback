export const Events = {
  MEDIA_ATTACHING: "mediaAttaching",
  MEDIA_ATTACHED: "mediaAttached",
  MEDIA_DETACHED: "mediaDetached",
};

type MediaAttachingEvent = {
  media: HTMLMediaElement;
};

type MediaAttachedEvent = {
  media: HTMLMediaElement;
};

export interface EventMap {
  [Events.MEDIA_ATTACHING]: (event: MediaAttachingEvent) => void;
  [Events.MEDIA_ATTACHED]: (event: MediaAttachedEvent) => void;
  [Events.MEDIA_DETACHED]: undefined;
}
