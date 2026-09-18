import ClientList from '../components/ClientList'
import Layout from '../components/Layout'
import { requireUserSSR } from '../lib/auth'

export async function getServerSideProps(context) {
  return requireUserSSR(context)
}

export default function Home({ user }) {
  return (
    <Layout title="Customers" user={user}>
      <ClientList />
    </Layout>
  )
}
