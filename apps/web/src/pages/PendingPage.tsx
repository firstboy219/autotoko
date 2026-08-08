import { Layout } from "../components/Layout";
import { PendingTasksList } from "../components/PendingTasks";
import { PageHeader } from "../components/ui";

/** Everything the system knows is incomplete, in one place. */
export function PendingPage() {
  return (
    <Layout title="Data Belum Lengkap">
      <PageHeader
        title="Data Belum Lengkap"
        subtitle="Hal-hal yang belum selesai dan apa akibatnya kalau dibiarkan."
      />
      <PendingTasksList />
    </Layout>
  );
}
