/**
 * FLOW AUTOMATION — Test Account Creation
 * File: src/test-create-accounts.ts
 *
 * Chạy: npx ts-node src/test-create-accounts.ts
 *
 * Test tạo N tài khoản Grok song song qua temp-mail + xAI sign up.
 */

import path from 'path'
import { ProfileManager } from './automation/ProfileManager'
import { WorkerEventType } from './automation/types'

// ════════════════════════════════════════════════════════════
//  ⚙️  CONFIG
// ════════════════════════════════════════════════════════════

const CONFIG = {
  // Số tài khoản muốn tạo
  accountCount: 5,

  // Thư mục chứa tất cả Chrome profiles
  profilesDir: path.resolve('./profiles'),
}

// ════════════════════════════════════════════════════════════
//  🚀  Main
// ════════════════════════════════════════════════════════════

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`)

async function main() {
  log(`🚀 Test Account Creation — ${CONFIG.accountCount} profiles`)
  log(`📂 Profiles dir: ${CONFIG.profilesDir}`)
  log('─────────────────────────────────────────────')

  const manager = new ProfileManager(
    CONFIG.profilesDir,
    (type: WorkerEventType, payload: any) => {
      switch (type) {
        case 'progress':
          process.stdout.write(
            `\r  [${payload.profileId}] ⏳ ${String(payload.step).padEnd(30)} ${String(payload.percent).padStart(3)}%`
          )
          if (payload.percent === 100) process.stdout.write('\n')
          break

        case 'completed':
          log(`  ✅ [${payload.profileId}] ready — ${payload.email}`)
          break

        case 'failed':
          log(`  ❌ [${payload.profileId}] thất bại — ${payload.error}`)
          break

        case 'log':
          // Chỉ in warn/error để không spam
          if (payload.level === 'warn' || payload.level === 'error') {
            log(`  ${payload.level === 'error' ? '❌' : '⚠️ '} [${payload.profileId ?? 'manager'}] ${payload.message}`)
          }
          break
      }
    }
  )

  // Cleanup khi Ctrl+C
  process.on('SIGINT', async () => {
    log('\n👋 Đang thoát — đóng tất cả Chrome...')
    await manager.closeAll()
    process.exit(0)
  })

  try {
    let readyProfiles = await manager.createAccounts(CONFIG.accountCount)

        // Auto retry profiles that bai (toi da 2 lan)
        for (let attempt = 1; attempt <= 2; attempt++) {
        const failed = manager.getAllProfiles().filter(p => p.status === 'failed')
        if (failed.length === 0) break

        log(`\n🔄 Retry lan ${attempt}: ${failed.length} profiles that bai...`)
        await new Promise(r => setTimeout(r, 5000))  // cho 5s truoc khi retry
        const retried = await manager.retryFailedAccounts()
        readyProfiles = manager.getReadyProfiles()
        log(`   Sau retry: ${readyProfiles.length}/${CONFIG.accountCount} ready`)
    }

    log('─────────────────────────────────────────────')
    log(`📊 Kết quả:`)
    log(`   ✅ Ready   : ${readyProfiles.length}/${CONFIG.accountCount}`)
    log(`   ❌ Failed  : ${CONFIG.accountCount - readyProfiles.length}/${CONFIG.accountCount}`)

    if (readyProfiles.length > 0) {
      log(`\n📋 Profiles ready:`)
      readyProfiles.forEach(p => {
        log(`   • ${p.profileId} — ${p.email}`)
      })
    }

    const allProfiles = manager.getAllProfiles()
    const failed = allProfiles.filter(p => p.status === 'failed')
    if (failed.length > 0) {
      log(`\n⚠️  Profiles thất bại:`)
      failed.forEach(p => {
        log(`   • ${p.profileId} — ${p.error}`)
      })
    }

    if (readyProfiles.length === CONFIG.accountCount) {
      log('\n🎉 Tất cả profiles ready!')
      await manager.closeAll()
      process.exit(0)
    } else {
      log('\n⏸️  Browser giữ mở để debug các profile thất bại')
      log('   Ấn Ctrl+C để thoát')
    }

  } catch (err: any) {
    log(`\n💥 Fatal error: ${err.message}`)
    await manager.closeAll()
    process.exit(1)
  }
}

main()