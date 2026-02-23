"use client";

import LoadingDots from "@/components/icons/loading-dots";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/tailwind/ui/dialog";
import { cn } from "@/lib/utils";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { deletePost } from "@/lib/actions";
import va from "@vercel/analytics";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Props = {
  postName: Promise<{ postName: string }>;
};

export default function DeletePostForm({ postName }: Props) {
  const [resolvedPostName, setResolvedPostName] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { id } = useParams() as { id: string };
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const result = await postName;
      setResolvedPostName(result.postName);
    })();
  }, [postName]);

  return (
    <div className="rounded-lg border border-red-600 bg-white dark:bg-black">
      <div className="relative flex flex-col space-y-4 p-5 sm:p-10">
        <h2 className="font-cal text-xl dark:text-white">Delete Post</h2>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Click here to delete <b>{resolvedPostName}</b>.
        </p>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="flex h-8 w-24 items-center justify-center rounded-md border border-red-600 bg-red-600 text-sm text-white transition-all hover:bg-white hover:text-red-600 focus:outline-none dark:hover:bg-transparent sm:h-10"
        >
          Delete
        </button>
      </div>

      <div className="flex flex-col items-center justify-center space-y-2 rounded-b-lg border-t border-stone-200 bg-stone-50 p-3 sm:flex-row sm:justify-between sm:space-y-0 sm:px-10 dark:border-stone-700 dark:bg-stone-800">
        <p className="text-center text-sm text-stone-500 dark:text-stone-400">
          This action is irreversible. Please proceed with caution.
        </p>
      </div>
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Delete Post</DialogTitle>
            <DialogDescription className="text-sm text-stone-500 dark:text-stone-400">
              Are you sure you want to delete <b>{resolvedPostName}</b>? This action is irreversible. Please proceed with caution.
            </DialogDescription>
          </DialogHeader>

          <form
            action={async (data: FormData) => {
              deletePost(data, id, "delete").then((res) => {
                if (res.error) {
                  toast.error(res.error);
                } else {
                  setIsModalOpen(false);
                  va.track("Deleted Post");
                  router.refresh();
                  router.push(`/site/${res.siteId}`);
                  toast.success(`Successfully deleted post!`);
                }
              });
            }}
            className="space-y-4"
          >
            <p className="text-sm text-stone-500 dark:text-stone-400">
              Please type <b>&quot;Delete&quot;</b> below to confirm.
            </p>
            <input
              name="confirm"
              type="text"
              required
              placeholder="Please confirm your delete request"
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-stone-500 focus:outline-none focus:ring-stone-500 dark:border-stone-600 dark:bg-black dark:text-white dark:placeholder-stone-700"
            />
            <DialogFooter>
              <div className="w-32">
                <FormButton />
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function FormButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className={cn(
        "flex h-8 w-32 items-center justify-center space-x-2 rounded-md border text-sm transition-all focus:outline-none sm:h-10",
        pending
          ? "cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
          : "border-red-600 bg-red-600 text-white hover:bg-white hover:text-red-600 dark:hover:bg-transparent",
      )}
      disabled={pending}
    >
      {pending ? <LoadingDots color="#808080" /> : <p>Confirm Delete</p>}
    </button>
  );
}
