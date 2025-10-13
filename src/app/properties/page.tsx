import { Properties } from "../../components/properties";
import { PageHeader } from "../../components/page-header";

export default function PropertiesPage() {
  return (
    <div>
      <PageHeader
        title="Properties"
        subtitle="Browse and filter investment properties across prime locations."
      />
      <Properties />
    </div>
  );
}