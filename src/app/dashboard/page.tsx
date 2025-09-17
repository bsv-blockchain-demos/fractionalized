import { Dashboard } from "../../components/dashboard";
import { PageHeader } from "../../components/page-header";

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Track performance and manage your portfolio at a glance."
      />
      <Dashboard />
    </div>
  );
}