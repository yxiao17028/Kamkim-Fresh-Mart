import { DbClient } from './database';
import { hashPassword } from '../services/auth';

export const DEFAULT_SLOTS = [
  { id: 'slot-0900', label: '09:00 AM - 11:00 AM', startHour: 9, endHour: 11, capacity: 25 },
  { id: 'slot-1100', label: '11:00 AM - 01:00 PM', startHour: 11, endHour: 13, capacity: 25 },
  { id: 'slot-1400', label: '02:00 PM - 04:00 PM', startHour: 14, endHour: 16, capacity: 25 },
  { id: 'slot-1600', label: '04:00 PM - 06:00 PM', startHour: 16, endHour: 18, capacity: 25 },
  { id: 'slot-1800', label: '06:00 PM - 08:00 PM', startHour: 18, endHour: 20, capacity: 25 },
];

const SEED_PRODUCTS = [
  {
    pospalUid: 'PP-1001',
    sku: 'KK-VEG-001',
    name: 'Cameron Highland Organic Baby Spinach (250g Pack)',
    nameZh: '金马伦有机嫩菠菜 (250克装)',
    nameMs: 'Bayam Muda Organik Cameron (Pek 250g)',
    category: 'Fresh Produce',
    basePriceSen: 490,
    stock: 42,
    unitLabel: '250g Pack',
    shortDescEn: 'Triple-washed highland baby spinach sealed in breathable freshness pack.',
    extEn: 'Harvested daily from Cameron Highlands and packed in fixed 250g retail pouches for instant cooking or salads.',
    extZh: '每日新鲜采摘自金马伦高原，经三次清洗并采用透气保鲜袋固定250克包装，即洗即煮。',
    extMs: 'Dituai setiap hari dari Tanah Tinggi Cameron dan dibungkus dalam pek 250g untuk kesegaran maksimum.',
    imageUrl: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&w=600&q=80',
    featured: 1,
  },
  {
    pospalUid: 'PP-1002',
    sku: 'KK-VEG-002',
    name: 'Japanese Sweet Corn Twin Pack (2pcs)',
    nameZh: '日本甜玉米双条装 (2条)',
    nameMs: 'Jagung Manis Jepun Pek Berkembar (2 Biji)',
    category: 'Fresh Produce',
    basePriceSen: 650,
    stock: 30,
    unitLabel: '2pcs Pack',
    shortDescEn: 'Juicy Pearl sweet corn sealed in twin pack.',
    extEn: 'Crisp and naturally sweet golden pearl corn, ideal for steaming, grilling, or soup.',
    extZh: '粒粒饱满香甜的珍珠玉米，适合清蒸、烧烤或煲汤。',
    extMs: 'Jagung mutiara manis semula jadi, sesuai untuk dikukus, dibakar atau dibuat sup.',
    imageUrl: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?auto=format&fit=crop&w=600&q=80',
    featured: 1,
  },
  {
    pospalUid: 'PP-1003',
    sku: 'KK-FRT-001',
    name: 'Fuji Apples Value Bag (5pcs Pack)',
    nameZh: '富士苹果实惠袋装 (5粒装)',
    nameMs: 'Epal Fuji Pek Nilai (5 Biji)',
    category: 'Fresh Produce',
    basePriceSen: 1290,
    stock: 25,
    unitLabel: '5pcs Pack',
    shortDescEn: 'Crisp imported Fuji apples in a fixed 5-piece net pack.',
    extEn: 'Selected Grade-A sweet crunchy apples packed 5 pieces per bag.',
    extZh: '严选A级爽脆香甜富士苹果，每袋固定5粒装。',
    extMs: 'Epal Fuji Gred A yang rangup dan manis, 5 biji setiap pek.',
    imageUrl: 'https://images.unsplash.com/photo-1568702846914-96b305d2aaeb?auto=format&fit=crop&w=600&q=80',
    featured: 0,
  },
  {
    pospalUid: 'PP-1004',
    sku: 'KK-DRY-001',
    name: 'Farm Fresh Pure Fresh Milk (1L Carton)',
    nameZh: 'Farm Fresh 纯鲜牛奶 (1公升盒装)',
    nameMs: 'Susu Segar Asli Farm Fresh (1 Liter)',
    category: 'Dairy & Chilled',
    basePriceSen: 890,
    stock: 36,
    unitLabel: '1L Carton',
    shortDescEn: '100% pure Malaysian pasteurised fresh cow milk.',
    extEn: 'Chilled daily delivery straight to Sungai Long. No preservatives, rich natural creamy taste.',
    extZh: '马来西亚本地牧场100%纯鲜牛奶，不含防腐剂，冷链直送双溪龙。',
    extMs: '100% susu lembu segar dipasteur tanpa bahan pengawet, dihantar sejuk setiap hari.',
    imageUrl: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=600&q=80',
    featured: 1,
  },
  {
    pospalUid: 'PP-1005',
    sku: 'KK-DRY-002',
    name: 'Kampung Omega-3 Fresh Eggs (10pcs Tray)',
    nameZh: '甘榜 Omega-3 鲜鸡蛋 (10粒装)',
    nameMs: 'Telur Ayam Kampung Omega-3 (10 Biji)',
    category: 'Dairy & Chilled',
    basePriceSen: 780,
    stock: 48,
    unitLabel: '10pcs Tray',
    shortDescEn: 'Enriched kampung eggs with deep golden yolks.',
    extEn: 'Cleaned and graded Grade-A Omega-3 kampung eggs in sturdy 10-egg carton.',
    extZh: '经过清洁分级的优质甘榜Omega-3鸡蛋，蛋黄浓香，每盒10粒。',
    extMs: 'Telur kampung Gred A diperkaya Omega-3 dalam pek 10 biji yang selamat.',
    imageUrl: 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?auto=format&fit=crop&w=600&q=80',
    featured: 1,
  },
  {
    pospalUid: 'PP-1006',
    sku: 'KK-MEA-001',
    name: 'Ayam Brand Sakurajima Chicken Breast Fillet (500g Pack)',
    nameZh: '无激素鲜嫩鸡胸肉 (500克真空装)',
    nameMs: 'Isi Dada Ayam Tanpa Hormon (Pek 500g)',
    category: 'Meat & Seafood',
    basePriceSen: 1150,
    stock: 22,
    unitLabel: '500g Vacuum Pack',
    shortDescEn: 'Skinless antibiotic-free chilled chicken breast fillets.',
    extEn: 'Halal-certified fixed 500g vacuum pack, trimmed and ready for healthy meal prep.',
    extZh: '清真认证无激素去皮鸡胸肉，固定500克真空包装，干净省时。',
    extMs: 'Disahkan Halal, bebas hormon dan antibiotik. Pek vakum 500g siap untuk dimasak.',
    imageUrl: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=600&q=80',
    featured: 0,
  },
  {
    pospalUid: 'PP-1007',
    sku: 'KK-SEA-001',
    name: 'Norwegian Atlantic Salmon Portion (200g Pack)',
    nameZh: '挪威大西洋三文鱼扒 (200克装)',
    nameMs: 'Potongan Salmon Atlantik Norway (200g)',
    category: 'Meat & Seafood',
    basePriceSen: 2490,
    stock: 15,
    unitLabel: '200g Frozen Pack',
    shortDescEn: 'Individually vacuum-packed skin-on Atlantic salmon.',
    extEn: 'Rich in Omega-3 fatty acids, flash-frozen at peak freshness in fixed 200g portions.',
    extZh: '富含Omega-3脂肪酸，急速锁鲜独立真空200克装，香煎气炸皆宜。',
    extMs: 'Kaya dengan Omega-3, dibekukan segera dalam potongan individu 200g.',
    imageUrl: 'https://images.unsplash.com/photo-1599084993091-1cb5c0721cc6?auto=format&fit=crop&w=600&q=80',
    featured: 1,
  },
  {
    pospalUid: 'PP-1008',
    sku: 'KK-PAN-001',
    name: 'Cap Rambutan Thai Hom Mali Fragrant Rice (5kg Bag)',
    nameZh: '红毛丹牌泰国香米 (5公斤装)',
    nameMs: 'Beras Wangi Thai Cap Rambutan (5kg)',
    category: 'Pantry & Grains',
    basePriceSen: 3290,
    stock: 28,
    unitLabel: '5kg Bag',
    shortDescEn: 'AAA Grade imported Thai Jasmine rice.',
    extEn: 'Soft, aromatic long-grain Thai Hom Mali rice trusted by Malaysian households.',
    extZh: '泰国原装进口AAA级茉莉香米，饭粒软糯清香，家庭必备主食。',
    extMs: 'Beras wangi Thai Gred AAA yang lembut dan harum untuk seisi keluarga.',
    imageUrl: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=600&q=80',
    featured: 1,
  },
  {
    pospalUid: 'PP-1009',
    sku: 'KK-PAN-002',
    name: 'Lee Kum Kee Premium Oyster Sauce (510g Bottle)',
    nameZh: '李锦记旧庄特级蚝油 (510克瓶装)',
    nameMs: 'Sos Tiram Premium Lee Kum Kee (510g)',
    category: 'Pantry & Grains',
    basePriceSen: 1450,
    stock: 34,
    unitLabel: '510g Bottle',
    shortDescEn: 'Rich authentic oyster extract cooking sauce.',
    extEn: 'Crafted from select oyster extracts for stir-fries, marinades, and braised dishes.',
    extZh: '百年秘方精选鲜蚝熬制，提鲜增味，煎炒焖煮必备调味料。',
    extMs: 'Diperbuat daripada ekstrak tiram pilihan untuk tumisan dan perapan yang lazat.',
    imageUrl: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=600&q=80',
    featured: 0,
  },
  {
    pospalUid: 'PP-1010',
    sku: 'KK-BEV-001',
    name: 'Milo Activ-Go Chocolate Malt Drink (1kg Pack)',
    nameZh: '美禄可可麦芽营养饮品 (1公斤装)',
    nameMs: 'Minuman Coklat Malt Milo Activ-Go (1kg)',
    category: 'Beverages & Snacks',
    basePriceSen: 2150,
    stock: 19,
    unitLabel: '1kg Refill Pack',
    shortDescEn: 'Classic Malaysian chocolate malt breakfast drink.',
    extEn: 'With Protomalt, vitamins and minerals for daily energy.',
    extZh: '马来西亚国民经典巧克力麦芽饮品，富含维生素与矿物质。',
    extMs: 'Minuman coklat malt kegemaran rakyat Malaysia dengan Protomalt dan vitamin.',
    imageUrl: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=600&q=80',
    featured: 0,
  },
  {
    pospalUid: 'PP-1011',
    sku: 'KK-BEV-002',
    name: 'OldTown White Coffee 3-in-1 Classic (15 Sticks)',
    nameZh: '旧街场经典三合一白咖啡 (15条装)',
    nameMs: 'Kopi Putih Klasik OldTown 3-dalam-1 (15 Pek)',
    category: 'Beverages & Snacks',
    basePriceSen: 1680,
    stock: 0, // Seed one out-of-stock item to demonstrate FR-008 & AT-09!
    unitLabel: '15 x 38g Pack',
    shortDescEn: 'Smooth aromatic Ipoh-style white coffee blend.',
    extEn: 'Currently sold out in POSPAL inventory; restocking soon.',
    extZh: '怡保传统风味三合一白咖啡，香浓顺滑。（当前POSPAL库存售罄）',
    extMs: 'Kopi putih klasik gaya Ipoh yang harum dan berkrim. (Stok habis buat masa ini)',
    imageUrl: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=600&q=80',
    featured: 0,
  },
  {
    pospalUid: 'PP-1012',
    sku: 'KK-HSH-001',
    name: 'Premier Deluxe Facial Tissue Soft Pack (4 x 200 Sheets)',
    nameZh: 'Premier 加厚柔韧面巾纸 (4包 x 200抽)',
    nameMs: 'Tisu Muka Lembut Premier (4 x 200 Helai)',
    category: 'Household',
    basePriceSen: 1290,
    stock: 40,
    unitLabel: '4-Pack Bundle',
    shortDescEn: '2-ply 100% virgin pulp soft facial tissue bundle.',
    extEn: 'Soft, absorbent, and gentle on skin in a convenient 4-pack household bundle.',
    extZh: '100%原生木浆双层柔韧面巾纸，4包家庭实惠装。',
    extMs: 'Tisu muka 2-lapis diperbuat daripada 100% pulpa dara yang lembut.',
    imageUrl: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=600&q=80',
    featured: 0,
  },
];

export function seedDatabase(db: DbClient): void {
  const existingSettings = db.get<{ id: number }>('SELECT id FROM store_settings WHERE id = 1');
  if (existingSettings) return;

  const now = new Date().toISOString();

  db.transaction(() => {
    db.run(
      `INSERT INTO store_settings
       (id, store_name, store_address, store_phone, store_whatsapp, store_map_url, store_facebook_url, owner_name, owner_email, owner_phone, operating_hours_json, slots_json, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'KamKim Fresh Mart',
        '40G, Jalan SL 1/2, Bandar Sungai Long, 43000 Kajang, Selangor',
        '014-9314390',
        '014-9314390',
        'https://maps.app.goo.gl/RcdFYV2JjrTtXaC36',
        'https://www.facebook.com/profile.php?id=100075855163757',
        'Mr. Kam (Owner)',
        'kamkim131414@gmail.com',
        '014-9314390',
        JSON.stringify({ monSat: '09:00 - 20:00', sun: '09:00 - 20:00', timezone: 'Asia/Kuala_Lumpur' }),
        JSON.stringify(DEFAULT_SLOTS),
        now,
      ],
    );

    // Two-role Admin model (Owner + Staff)
    const ownerPass = process.env.OWNER_INITIAL_PASSWORD || 'kamkim1314';
    const staffPass = process.env.STAFF_INITIAL_PASSWORD || 'kk1314';
    db.run(
      `INSERT INTO admin_users (username, display_name, email, role, can_process_refunds, password_hash, is_active, created_at)
       VALUES (?, ?, ?, 'owner', 1, ?, 1, ?)`,
      ['owner', 'Mr. Kam (Owner)', 'kamkim131414@gmail.com', hashPassword(ownerPass), now],
    );
    db.run(
      `INSERT INTO admin_users (username, display_name, email, role, can_process_refunds, password_hash, is_active, created_at)
       VALUES (?, ?, ?, 'staff', 0, ?, 1, ?)`,
      ['staff', 'Mei Ling (Store Staff)', 'staff@kamkimfresh.my', hashPassword(staffPass), now],
    );

    // Skip seeding demo products & mock POSPAL items when running in live POSPAL mode or when snapshot catalogue is loaded
    const existingProducts = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM products');
    const seedDemoCatalogue =
      (process.env.POSPAL_MODE !== 'live' || process.env.SEED_DEMO_PRODUCTS === 'true') &&
      (existingProducts?.c ?? 0) === 0;
    if (!seedDemoCatalogue) {
      return;
    }

    // Demo registered customer
    const custRes = db.run(
      `INSERT INTO customers (email, name, phone, password_hash, default_address, default_postcode, preferred_lang, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'en', ?)`,
      [
        'customer@example.com',
        'Tan Wei Ming',
        '+6016-7788990',
        hashPassword('customer123'),
        '15, Jalan SL 6/3, Bandar Sungai Long, Kajang',
        '43000',
        now,
      ],
    );
    db.run(
      `INSERT INTO customer_addresses (customer_id, label, recipient_name, phone, address, postcode, is_default, last_used_at, created_at)
       VALUES (?, 'Home', 'Tan Wei Ming', '+6016-7788990', '15, Jalan SL 6/3, Bandar Sungai Long, Kajang', '43000', 1, ?, ?)`,
      [custRes.lastInsertRowid, now, now],
    );

    for (const p of SEED_PRODUCTS) {
      db.run(
        `INSERT INTO pospal_mock_products (pospal_uid, sku, name, category, base_price_sen, stock_on_hand, revision, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [p.pospalUid, p.sku, p.name, p.category, p.basePriceSen, p.stock, now],
      );

      db.run(
        `INSERT INTO products
         (pospal_uid, sku, name, name_zh, name_ms, category, base_price_sen, pospal_stock, sellable_stock, pospal_revision, pospal_updated_at, unit_label, short_desc_en, extended_desc_en, extended_desc_zh, extended_desc_ms, image_url, seo_slug, is_featured, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          p.pospalUid,
          p.sku,
          p.name,
          p.nameZh,
          p.nameMs,
          p.category,
          p.basePriceSen,
          p.stock,
          p.stock,
          now,
          p.unitLabel,
          p.shortDescEn,
          p.extEn,
          p.extZh,
          p.extMs,
          p.imageUrl,
          p.sku.toLowerCase(),
          p.featured,
          now,
        ],
      );
    }
  });
}
