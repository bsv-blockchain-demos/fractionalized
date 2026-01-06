import { Suspense } from "react";
import { Properties } from "../../components/properties";
import { PageHeader } from "../../components/page-header";

export default function PropertiesPage() {
  return (
    <div>
      <PageHeader
        title="Properties"
        subtitle="Browse and filter investment properties across prime locations."
      />
      <Suspense fallback={<div className="container mx-auto px-4 py-6 text-text-secondary">Loading properties...</div>}>
        <Properties />
      </Suspense>
    </div>
  );
}