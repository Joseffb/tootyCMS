import { createImageUpload } from "novel";
import { toast } from "sonner";
import { uploadSmart } from "@/lib/uploadSmart";

export const createUploadFn = (siteId: string, name: "image" | "logo" | "heroImage" | "post") => {
  return createImageUpload({
    onUpload: async (file: File) => {
      const upload = async () => {
        const { url } = await uploadSmart({ file, siteId, name });
        return { url };
      };

      // 👇 Wrap in toast promise
      return new Promise((resolve, reject) => {
        toast.promise(
          upload().then((res) => {
            if (!res || !res.url) throw new Error("Upload failed: No URL returned.");

            // Preload image
            const image = new Image();
            image.src = res.url;
            image.onload = () => resolve(res.url);
          }),
          {
            loading: "Uploading image...",
            success: "Image uploaded successfully.",
            error: (e) => {
              reject(e);
              return e.message || "Upload failed.";
            },
          },
        );
      });
    },

    validateFn: (file) => {
      if (!file.type.includes("image/")) {
        toast.error("File type not supported.");
        return false;
      }
      if (file.size / 1024 / 1024 > 20) {
        toast.error("File size too big (max 20MB).");
        return false;
      }
      return true;
    },
  });
};
