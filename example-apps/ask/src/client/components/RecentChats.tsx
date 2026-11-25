// Recent Chats: the person's own chats. 2c lists them here.
import { PageHeader } from '@featherbase/shop-floor'

export function RecentChats() {
  return (
    <main className="ask-page">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
        <PageHeader title="Recent Chats" status="Every chat you have had with Ask. Open one to carry on." />
      </div>
    </main>
  )
}