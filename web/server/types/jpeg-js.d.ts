declare module 'jpeg-js' {
  export interface RawImageData<T = Buffer | Uint8Array> {
    data: T;
    width: number;
    height: number;
  }

  export function encode(
    imgData: { data: Uint8Array | Buffer; width: number; height: number },
    quality?: number
  ): { data: Buffer; width: number; height: number };

  export function decode(
    jpegData: Uint8Array | Buffer,
    opts?: {
      useTArray?: boolean;
      colorTransform?: boolean;
      formatAsRGBA?: boolean;
      tolerantDecoding?: boolean;
      maxResolutionInMP?: number;
      maxMemoryUsageInMB?: number;
    }
  ): RawImageData<Uint8Array>;
}
