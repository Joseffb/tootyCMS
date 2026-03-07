import { Suspense } from "react";
import Sites from "@/components/sites";
import CreateSiteButton from "@/components/create-site-button";
import CreateSiteModal from "@/components/modal/create-site";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function AllSites() {
  return (
    <div className="flex max-w-screen-xl flex-col space-y-12 p-8">
      <div className="flex flex-col space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-cal text-3xl font-bold light:text-black">
            All Sites
          </h1>
          <CreateSiteButton>
            <CreateSiteModal />
          </CreateSiteButton>
        </div>
        <Suspense fallback={null}>
          <Sites />
        </Suspense>
      </div>
    </div>
  );
}
