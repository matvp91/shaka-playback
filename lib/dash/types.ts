export type MPD = {
  BaseURL?: TextNode;
  Period: Period[];
};

export type Period = {
  BaseURL?: TextNode;
  AdaptationSet: AdaptationSet[];
};

export type AdaptationSet = {
  "@_group"?: string;
  "@_contentType"?: string;
  "@_mimeType"?: string;
  "@_codecs"?: string;
  "@_width"?: string;
  "@_height"?: string;
  BaseURL?: TextNode;
  Representation: Representation[];
};

export type Representation = {
  "@_mimeType"?: string;
  "@_codecs"?: string;
  "@_width"?: string;
  "@_height"?: string;
  BaseURL?: TextNode;
};

export type TextNode = {
  "#text": string;
};
