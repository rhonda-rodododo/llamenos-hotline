export const home: Record<string, {
  hero: {
    badge: string;
    title: string;
    titleAccent: string;
    description: string;
    cta: string;
    ctaSecondary: string;
  };
  features: {
    heading: string;
    subtitle: string;
    items: Array<{ icon: string; title: string; description: string }>;
  };
  security: {
    heading: string;
    description: string;
    link: string;
  };
  deploy: {
    heading: string;
    description: string;
    cta: string;
    github: string;
  };
}> = {
  en: {
    hero: {
      badge: 'Open source \u00b7 End-to-end encrypted',
      title: 'Secure crisis hotline',
      titleAccent: 'for the people who need it',
      description: 'Llámenos is open-source hotline software that protects callers and volunteers. Encrypted notes, real-time call routing, and a zero-knowledge architecture \u2014 so sensitive conversations stay private.',
      cta: 'Get started',
      ctaSecondary: 'Read the security model',
    },
    features: {
      heading: 'Built for crisis response',
      subtitle: 'Everything a hotline needs \u2014 call routing, encrypted note-taking, shift management, and admin tools \u2014 in a single open-source package.',
      items: [
        { icon: '\u{1F512}', title: 'End-to-end encrypted notes', description: 'Call notes are encrypted with per-note forward secrecy — each note uses a unique random key. Your secret key is PIN-protected and never leaves your device.' },
        { icon: '\u{1F4DE}', title: 'Parallel call ringing', description: 'Incoming calls ring all on-shift volunteers simultaneously. First pickup wins. No calls missed.' },
        { icon: '\u{1F30D}', title: '12+ languages built in', description: 'Full UI translations for English, Spanish, Chinese, Tagalog, Vietnamese, Arabic, French, Haitian Creole, Korean, Russian, Hindi, and Portuguese.' },
        { icon: '\u{1F399}', title: 'AI transcription', description: 'Whisper-powered call transcription with end-to-end encryption. Admin and volunteer can toggle independently.' },
        { icon: '\u{1F6E1}', title: 'Spam mitigation', description: 'Voice CAPTCHA, rate limiting, and real-time ban lists. Admins toggle protections without restarting.' },
        { icon: '\u{1F4F1}', title: 'Mobile-first PWA', description: 'Works on any device. Installable as an app. Push notifications for incoming calls.' },
      ],
    },
    security: {
      heading: 'Honest about security',
      description: "We publish exactly what is encrypted, what isn't, and what the server can see. No hand-waving. Your secret key is PIN-encrypted and held only in memory when unlocked. Per-note forward secrecy means compromising a key can't reveal past notes. Link new devices securely via QR code. Read the full security model to understand our threat landscape.",
      link: 'Read the security model',
    },
    deploy: {
      heading: 'Ready to deploy?',
      description: 'Llámenos is self-hosted via Docker — you control everything. Get a hotline running in under an hour.',
      cta: 'Get started',
      github: 'View on GitHub',
    },
  },
  es: {
    hero: {
      badge: 'Código abierto \u00b7 Cifrado de extremo a extremo',
      title: 'Línea de crisis segura',
      titleAccent: 'para quienes la necesitan',
      description: 'Llámenos es un software de línea de ayuda de código abierto que protege a quienes llaman y a los voluntarios. Notas cifradas, enrutamiento de llamadas en tiempo real y una arquitectura de conocimiento cero \u2014 para que las conversaciones sensibles permanezcan privadas.',
      cta: 'Comenzar',
      ctaSecondary: 'Leer el modelo de seguridad',
    },
    features: {
      heading: 'Diseñado para respuesta a crisis',
      subtitle: 'Todo lo que una línea de ayuda necesita \u2014 enrutamiento de llamadas, notas cifradas, gestión de turnos y herramientas de administración \u2014 en un solo paquete de código abierto.',
      items: [
        { icon: '\u{1F512}', title: 'Notas cifradas de extremo a extremo', description: 'Las notas se cifran con secreto hacia adelante por nota — cada nota usa una clave aleatoria unica. Tu clave secreta esta protegida por PIN y nunca sale de tu dispositivo.' },
        { icon: '\u{1F4DE}', title: 'Timbre paralelo', description: 'Las llamadas entrantes suenan en todos los voluntarios de turno simultáneamente. El primero en contestar obtiene la llamada.' },
        { icon: '\u{1F30D}', title: 'Más de 12 idiomas integrados', description: 'Traducciones completas de la interfaz para inglés, español, chino, tagalo, vietnamita, árabe, francés, criollo haitiano, coreano, ruso, hindi y portugués.' },
        { icon: '\u{1F399}', title: 'Transcripción con IA', description: 'Transcripción de llamadas con Whisper y cifrado de extremo a extremo. El administrador y el voluntario pueden activarla independientemente.' },
        { icon: '\u{1F6E1}', title: 'Mitigación de spam', description: 'CAPTCHA de voz, limitación de tasa y listas de bloqueo en tiempo real. Los administradores activan las protecciones sin reiniciar.' },
        { icon: '\u{1F4F1}', title: 'PWA móvil primero', description: 'Funciona en cualquier dispositivo. Instalable como aplicación. Notificaciones push para llamadas entrantes.' },
      ],
    },
    security: {
      heading: 'Honestos sobre la seguridad',
      description: 'Publicamos exactamente qué está cifrado, qué no lo está y qué puede ver el servidor. Sin ambigüedades. Tu clave secreta está cifrada con PIN y solo en memoria cuando está desbloqueada. El secreto hacia adelante por nota significa que comprometer una clave no revela notas pasadas. Vincula nuevos dispositivos de forma segura via código QR. Lee el modelo de seguridad completo.',
      link: 'Leer el modelo de seguridad',
    },
    deploy: {
      heading: '¿Listo para desplegar?',
      description: 'Llámenos se auto-aloja con Docker — tú controlas todo. Pon en marcha una línea de ayuda en menos de una hora.',
      cta: 'Comenzar',
      github: 'Ver en GitHub',
    },
  },
  zh: {
    hero: {
      badge: '开源 \u00b7 端到端加密',
      title: '安全的危机热线',
      titleAccent: '为需要帮助的人而建',
      description: 'Llámenos 是保护来电者和志愿者的开源热线软件。加密笔记、实时呼叫路由和零知识架构——确保敏感对话保持私密。',
      cta: '开始使用',
      ctaSecondary: '阅读安全模型',
    },
    features: {
      heading: '专为危机响应打造',
      subtitle: '热线所需的一切——呼叫路由、加密笔记、排班管理和管理工具——集于一个开源项目。',
      items: [
        { icon: '\u{1F512}', title: '端到端加密笔记', description: '通话笔记采用逐条前向保密加密——每条笔记使用唯一的随机密钥。您的密钥由PIN保护，永远不会离开您的设备。' },
        { icon: '\u{1F4DE}', title: '并行振铃', description: '来电同时响铃所有在班志愿者。第一个接听的人获得通话，其他停止振铃。' },
        { icon: '\u{1F30D}', title: '内置12+种语言', description: '完整的界面翻译，支持英语、西班牙语、中文、他加禄语、越南语、阿拉伯语、法语、海地克里奥尔语、韩语、俄语、印地语和葡萄牙语。' },
        { icon: '\u{1F399}', title: 'AI 转录', description: '基于 Whisper 的通话转录，端到端加密。管理员和志愿者可独立切换。' },
        { icon: '\u{1F6E1}', title: '垃圾来电防护', description: '语音 CAPTCHA、速率限制和实时封禁列表。管理员无需重启即可切换保护。' },
        { icon: '\u{1F4F1}', title: '移动优先 PWA', description: '适用于任何设备。可安装为应用。来电推送通知。' },
      ],
    },
    security: {
      heading: '坦诚的安全声明',
      description: '我们准确公布哪些内容已加密、哪些未加密以及服务器能看到什么。绝不含糊。您的密钥由PIN加密，解锁时仅存在于内存中。逐条前向保密意味着泄露密钥无法揭示过去的笔记。通过二维码安全链接新设备。阅读完整的安全模型。',
      link: '阅读安全模型',
    },
    deploy: {
      heading: '准备好部署了吗？',
      description: 'Llámenos 通过 Docker 自托管 — 一切由您掌控。不到一小时即可启动热线。',
      cta: '开始使用',
      github: '在 GitHub 上查看',
    },
  },
  tl: {
    hero: {
      badge: 'Open source \u00b7 End-to-end encrypted',
      title: 'Secure na crisis hotline',
      titleAccent: 'para sa mga nangangailangan',
      description: 'Ang Llámenos ay open-source na hotline software na nagpoprotekta sa mga tumatawag at mga volunteer. Encrypted na mga tala, real-time na call routing, at zero-knowledge architecture \u2014 para manatiling pribado ang mga sensitibong usapan.',
      cta: 'Magsimula',
      ctaSecondary: 'Basahin ang modelo ng seguridad',
    },
    features: {
      heading: 'Ginawa para sa crisis response',
      subtitle: 'Lahat ng kailangan ng isang hotline \u2014 call routing, encrypted na pagsusulat ng tala, pamamahala ng shift, at admin tools \u2014 sa isang open-source na pakete.',
      items: [
        { icon: '\u{1F512}', title: 'End-to-end encrypted na mga tala', description: 'Ang mga tala ay naka-encrypt na may per-note forward secrecy — bawat tala ay gumagamit ng natatanging random key. Ang iyong secret key ay protektado ng PIN at hindi umaalis sa iyong device.' },
        { icon: '\u{1F4DE}', title: 'Sabay-sabay na pag-ring', description: 'Ang mga papasok na tawag ay nagri-ring sa lahat ng on-shift na volunteer nang sabay-sabay. Unang sumagot, siya ang makakausap.' },
        { icon: '\u{1F30D}', title: '12+ na wika ang built-in', description: 'Kumpletong pagsasalin ng UI para sa Ingles, Espanyol, Tsino, Tagalog, Vietnamese, Arabe, Pranses, Haitian Creole, Korean, Ruso, Hindi, at Portuges.' },
        { icon: '\u{1F399}', title: 'AI na transkripsyon', description: 'Transkripsyon ng tawag gamit ang Whisper na may end-to-end encryption. Maaaring i-toggle ng admin at volunteer nang hiwalay.' },
        { icon: '\u{1F6E1}', title: 'Proteksyon laban sa spam', description: 'Voice CAPTCHA, rate limiting, at real-time na ban list. Maaaring i-toggle ng mga admin ang proteksyon nang hindi nire-restart.' },
        { icon: '\u{1F4F1}', title: 'Mobile-first PWA', description: 'Gumagana sa anumang device. Maaaring i-install bilang app. Push notification para sa papasok na tawag.' },
      ],
    },
    security: {
      heading: 'Tapat tungkol sa seguridad',
      description: 'Inilalathala namin nang eksakto kung ano ang naka-encrypt, ano ang hindi, at ano ang nakikita ng server. Walang pambubulag. Ang iyong secret key ay naka-encrypt ng PIN at nasa memory lang kapag naka-unlock. Per-note forward secrecy ang ibig sabihin ay hindi maibubunyag ang mga nakaraang tala. Ligtas na i-link ang mga bagong device sa pamamagitan ng QR code.',
      link: 'Basahin ang modelo ng seguridad',
    },
    deploy: {
      heading: 'Handa nang mag-deploy?',
      description: 'Ang Llámenos ay self-hosted gamit ang Docker — ikaw ang may kontrol sa lahat. Magpatakbo ng hotline sa loob ng isang oras.',
      cta: 'Magsimula',
      github: 'Tingnan sa GitHub',
    },
  },
  vi: {
    hero: {
      badge: 'Mã nguồn mở \u00b7 Mã hóa đầu cuối',
      title: 'Đường dây nóng khủng hoảng an toàn',
      titleAccent: 'cho những người cần nó',
      description: 'Llámenos là phần mềm đường dây nóng mã nguồn mở bảo vệ người gọi và tình nguyện viên. Ghi chú được mã hóa, định tuyến cuộc gọi thời gian thực và kiến trúc không tiết lộ \u2014 để các cuộc trò chuyện nhạy cảm luôn riêng tư.',
      cta: 'Bắt đầu',
      ctaSecondary: 'Đọc mô hình bảo mật',
    },
    features: {
      heading: 'Xây dựng cho ứng phó khủng hoảng',
      subtitle: 'Mọi thứ một đường dây nóng cần \u2014 định tuyến cuộc gọi, ghi chú mã hóa, quản lý ca trực và công cụ quản trị \u2014 trong một gói mã nguồn mở.',
      items: [
        { icon: '\u{1F512}', title: 'Ghi chú mã hóa đầu cuối', description: 'Ghi chú được mã hóa với tính bảo mật chuyển tiếp — mỗi ghi chú sử dụng một khóa ngẫu nhiên duy nhất. Khóa bí mật của bạn được bảo vệ bằng PIN và không bao giờ rời khỏi thiết bị.' },
        { icon: '\u{1F4DE}', title: 'Đổ chuông song song', description: 'Cuộc gọi đến đổ chuông đồng thời cho tất cả tình nguyện viên đang trực. Người đầu tiên trả lời sẽ nhận cuộc gọi.' },
        { icon: '\u{1F30D}', title: 'Hơn 12 ngôn ngữ tích hợp', description: 'Bản dịch giao diện đầy đủ cho tiếng Anh, Tây Ban Nha, Trung Quốc, Tagalog, Việt Nam, Ả Rập, Pháp, Creole Haiti, Hàn Quốc, Nga, Hindi và Bồ Đào Nha.' },
        { icon: '\u{1F399}', title: 'Phiên âm AI', description: 'Phiên âm cuộc gọi bằng Whisper với mã hóa đầu cuối. Quản trị viên và tình nguyện viên có thể bật/tắt độc lập.' },
        { icon: '\u{1F6E1}', title: 'Chống spam', description: 'CAPTCHA giọng nói, giới hạn tốc độ và danh sách cấm thời gian thực. Quản trị viên bật/tắt bảo vệ mà không cần khởi động lại.' },
        { icon: '\u{1F4F1}', title: 'PWA ưu tiên di động', description: 'Hoạt động trên mọi thiết bị. Có thể cài đặt như ứng dụng. Thông báo đẩy cho cuộc gọi đến.' },
      ],
    },
    security: {
      heading: 'Trung thực về bảo mật',
      description: 'Chúng tôi công bố chính xác những gì được mã hóa, những gì không và những gì máy chủ có thể thấy. Không mập mờ. Khóa bí mật của bạn được mã hóa bằng PIN và chỉ tồn tại trong bộ nhớ khi mở khóa. Bảo mật chuyển tiếp theo ghi chú nghĩa là lộ khóa không thể tiết lộ ghi chú trước đó. Liên kết thiết bị mới an toàn qua mã QR.',
      link: 'Đọc mô hình bảo mật',
    },
    deploy: {
      heading: 'Sẵn sàng triển khai?',
      description: 'Llámenos tự lưu trữ qua Docker — bạn kiểm soát mọi thứ. Khởi chạy đường dây nóng trong chưa đầy một giờ.',
      cta: 'Bắt đầu',
      github: 'Xem trên GitHub',
    },
  },
  ar: {
    hero: {
      badge: 'مفتوح المصدر \u00b7 تشفير من طرف إلى طرف',
      title: 'خط ساخن آمن للأزمات',
      titleAccent: 'للأشخاص الذين يحتاجونه',
      description: 'Llámenos هو برنامج خط ساخن مفتوح المصدر يحمي المتصلين والمتطوعين. ملاحظات مشفرة، وتوجيه مكالمات في الوقت الفعلي، وبنية معرفة صفرية \u2014 لتبقى المحادثات الحساسة خاصة.',
      cta: 'ابدأ الآن',
      ctaSecondary: 'اقرأ نموذج الأمان',
    },
    features: {
      heading: 'مصمم للاستجابة للأزمات',
      subtitle: 'كل ما يحتاجه خط ساخن \u2014 توجيه المكالمات، وتدوين الملاحظات المشفرة، وإدارة المناوبات، وأدوات الإدارة \u2014 في حزمة واحدة مفتوحة المصدر.',
      items: [
        { icon: '\u{1F512}', title: 'ملاحظات مشفرة من طرف إلى طرف', description: 'يتم تشفير الملاحظات بسرية تامة لكل ملاحظة — كل ملاحظة تستخدم مفتاحًا عشوائيًا فريدًا. مفتاحك السري محمي برمز PIN ولا يغادر جهازك أبدًا.' },
        { icon: '\u{1F4DE}', title: 'رنين متوازي', description: 'المكالمات الواردة ترن لجميع المتطوعين في المناوبة في وقت واحد. أول من يرد يحصل على المكالمة.' },
        { icon: '\u{1F30D}', title: 'أكثر من 12 لغة مدمجة', description: 'ترجمات كاملة للواجهة بالإنجليزية والإسبانية والصينية والتاغالوغية والفيتنامية والعربية والفرنسية والكريولية الهايتية والكورية والروسية والهندية والبرتغالية.' },
        { icon: '\u{1F399}', title: 'نسخ بالذكاء الاصطناعي', description: 'نسخ المكالمات بتقنية Whisper مع تشفير من طرف إلى طرف. يمكن للمسؤول والمتطوع التبديل بشكل مستقل.' },
        { icon: '\u{1F6E1}', title: 'مكافحة البريد المزعج', description: 'CAPTCHA صوتي، وتحديد المعدل، وقوائم حظر فورية. يمكن للمسؤولين تبديل الحماية دون إعادة التشغيل.' },
        { icon: '\u{1F4F1}', title: 'PWA للجوال أولاً', description: 'يعمل على أي جهاز. قابل للتثبيت كتطبيق. إشعارات فورية للمكالمات الواردة.' },
      ],
    },
    security: {
      heading: 'صادقون بشأن الأمان',
      description: 'ننشر بالضبط ما هو مشفر وما ليس كذلك وما يمكن للخادم رؤيته. بلا غموض. مفتاحك السري مشفر برمز PIN ويوجد في الذاكرة فقط عند فتح القفل. السرية التامة لكل ملاحظة تعني أن اختراق المفتاح لا يكشف الملاحظات السابقة. اربط أجهزة جديدة بأمان عبر رمز QR.',
      link: 'اقرأ نموذج الأمان',
    },
    deploy: {
      heading: 'مستعد للنشر؟',
      description: 'Llámenos مستضاف ذاتياً عبر Docker — أنت تتحكم في كل شيء. شغّل خطاً ساخناً في أقل من ساعة.',
      cta: 'ابدأ الآن',
      github: 'عرض على GitHub',
    },
  },
  fr: {
    hero: {
      badge: 'Open source \u00b7 Chiffrement de bout en bout',
      title: "Ligne d'urgence sécurisée",
      titleAccent: 'pour ceux qui en ont besoin',
      description: "Llámenos est un logiciel de ligne d'assistance open source qui protège les appelants et les bénévoles. Notes chiffrées, routage d'appels en temps réel et architecture zéro connaissance \u2014 pour que les conversations sensibles restent privées.",
      cta: 'Commencer',
      ctaSecondary: 'Lire le modèle de sécurité',
    },
    features: {
      heading: "Conçu pour la réponse aux crises",
      subtitle: "Tout ce dont une ligne d'assistance a besoin \u2014 routage d'appels, notes chiffrées, gestion des équipes et outils d'administration \u2014 dans un seul logiciel open source.",
      items: [
        { icon: '\u{1F512}', title: 'Notes chiffrées de bout en bout', description: "Les notes sont chiffrées avec un secret de transfert par note — chaque note utilise une clé aléatoire unique. Votre clé secrète est protégée par PIN et ne quitte jamais votre appareil." },
        { icon: '\u{1F4DE}', title: 'Sonnerie parallèle', description: "Les appels entrants sonnent simultanément chez tous les bénévoles en service. Le premier à décrocher obtient l'appel." },
        { icon: '\u{1F30D}', title: 'Plus de 12 langues intégrées', description: "Traductions complètes de l'interface : anglais, espagnol, chinois, tagalog, vietnamien, arabe, français, créole haïtien, coréen, russe, hindi et portugais." },
        { icon: '\u{1F399}', title: 'Transcription IA', description: "Transcription d'appels par Whisper avec chiffrement de bout en bout. L'administrateur et le bénévole peuvent activer/désactiver indépendamment." },
        { icon: '\u{1F6E1}', title: 'Protection anti-spam', description: "CAPTCHA vocal, limitation de débit et listes de blocage en temps réel. Les administrateurs activent les protections sans redémarrage." },
        { icon: '\u{1F4F1}', title: 'PWA mobile first', description: "Fonctionne sur tout appareil. Installable comme application. Notifications push pour les appels entrants." },
      ],
    },
    security: {
      heading: 'Honnêtes sur la sécurité',
      description: "Nous publions exactement ce qui est chiffré, ce qui ne l'est pas et ce que le serveur peut voir. Sans ambiguïté. Votre clé secrète est chiffrée par PIN et n'existe en mémoire que lorsqu'elle est déverrouillée. Le secret de transfert par note signifie que compromettre une clé ne révèle pas les notes passées. Liez de nouveaux appareils en toute sécurité via code QR.",
      link: 'Lire le modèle de sécurité',
    },
    deploy: {
      heading: 'Prêt à déployer ?',
      description: "Llámenos est auto-hébergé via Docker — vous contrôlez tout. Lancez une ligne d'assistance en moins d'une heure.",
      cta: 'Commencer',
      github: 'Voir sur GitHub',
    },
  },
  ht: {
    hero: {
      badge: 'Open source \u00b7 Chifre bout-an-bout',
      title: 'Liy kriz ki an sekirite',
      titleAccent: 'pou moun ki bezwen li',
      description: 'Llámenos se yon lojisyèl liy asistans open source ki pwoteje moun ki rele ak volontè yo. Nòt chifre, direksyon apèl an tan reyèl, ak achitekti zewo konesans \u2014 pou konvèsasyon sansib yo rete prive.',
      cta: 'Kòmanse',
      ctaSecondary: 'Li modèl sekirite a',
    },
    features: {
      heading: 'Fèt pou repons a kriz',
      subtitle: 'Tout sa yon liy asistans bezwen \u2014 direksyon apèl, nòt chifre, jesyon ekip, ak zouti admin \u2014 nan yon sèl pakè open source.',
      items: [
        { icon: '\u{1F512}', title: 'Nòt chifre bout-an-bout', description: 'Nòt yo chifre ak sekrè alavans pou chak nòt — chak nòt itilize yon kle o aza inik. Kle sekrè ou a pwoteje pa PIN epi li pa janm kite aparèy ou.' },
        { icon: '\u{1F4DE}', title: 'Sonri paralèl', description: 'Apèl ki rantre yo sonnen pou tout volontè ki sou ekip la an menm tan. Premye ki reponn nan pran apèl la.' },
        { icon: '\u{1F30D}', title: '12+ lang entegre', description: 'Tradiksyon konplè pou Angle, Panyòl, Chinwa, Tagalog, Vyetnamyen, Arab, Fransè, Kreyòl Ayisyen, Koreyen, Ris, Hindi, ak Pòtigè.' },
        { icon: '\u{1F399}', title: 'Transkripsyon IA', description: 'Transkripsyon apèl ak Whisper ki gen chifraj bout-an-bout. Admin ak volontè ka aktive/dezaktive endepandaman.' },
        { icon: '\u{1F6E1}', title: 'Pwoteksyon kont spam', description: 'CAPTCHA vwa, limit vitès, ak lis entèdiksyon an tan reyèl. Admin yo ka aktive pwoteksyon san redemaraj.' },
        { icon: '\u{1F4F1}', title: 'PWA mobil dabò', description: 'Mache sou nenpòt aparèy. Ka enstale tankou aplikasyon. Notifikasyon push pou apèl ki rantre.' },
      ],
    },
    security: {
      heading: 'Onèt sou sekirite',
      description: 'Nou pibliye egzakteman sa ki chifre, sa ki pa chifre, ak sa sèvè a ka wè. San dezòd. Kle sekrè ou a chifre pa PIN epi li sèlman nan memwa lè li debloke. Sekrè alavans pou chak nòt vle di konpwomèt yon kle pa ka revele nòt pase yo. Konekte nouvo aparèy an sekirite via kòd QR.',
      link: 'Li modèl sekirite a',
    },
    deploy: {
      heading: 'Pare pou deplwaye?',
      description: 'Llámenos se auto-hébergé via Docker — ou kontwole tout bagay. Lanse yon liy asistans nan mwens pase inèdtan.',
      cta: 'Kòmanse',
      github: 'Wè sou GitHub',
    },
  },
  ko: {
    hero: {
      badge: '오픈 소스 \u00b7 종단간 암호화',
      title: '안전한 위기 핫라인',
      titleAccent: '도움이 필요한 사람들을 위해',
      description: 'Llámenos는 발신자와 자원봉사자를 보호하는 오픈 소스 핫라인 소프트웨어입니다. 암호화된 메모, 실시간 통화 라우팅, 제로 지식 아키텍처 \u2014 민감한 대화를 비공개로 유지합니다.',
      cta: '시작하기',
      ctaSecondary: '보안 모델 읽기',
    },
    features: {
      heading: '위기 대응을 위해 구축',
      subtitle: '핫라인에 필요한 모든 것 \u2014 통화 라우팅, 암호화된 메모 작성, 교대 관리, 관리 도구 \u2014 하나의 오픈 소스 패키지로.',
      items: [
        { icon: '\u{1F512}', title: '종단간 암호화 메모', description: '메모는 메모별 전방 비밀성으로 암호화됩니다 — 각 메모는 고유한 랜덤 키를 사용합니다. 비밀 키는 PIN으로 보호되며 기기를 떠나지 않습니다.' },
        { icon: '\u{1F4DE}', title: '동시 벨 울림', description: '수신 전화가 근무 중인 모든 자원봉사자에게 동시에 울립니다. 먼저 받는 사람이 통화를 연결합니다.' },
        { icon: '\u{1F30D}', title: '12개 이상 언어 내장', description: '영어, 스페인어, 중국어, 타갈로그어, 베트남어, 아랍어, 프랑스어, 아이티 크리올어, 한국어, 러시아어, 힌디어, 포르투갈어 전체 UI 번역.' },
        { icon: '\u{1F399}', title: 'AI 녹취', description: 'Whisper 기반 통화 녹취, 종단간 암호화 포함. 관리자와 자원봉사자가 독립적으로 전환 가능.' },
        { icon: '\u{1F6E1}', title: '스팸 방지', description: '음성 CAPTCHA, 속도 제한, 실시간 차단 목록. 관리자가 재시작 없이 보호를 전환합니다.' },
        { icon: '\u{1F4F1}', title: '모바일 우선 PWA', description: '모든 기기에서 작동. 앱으로 설치 가능. 수신 전화 푸시 알림.' },
      ],
    },
    security: {
      heading: '보안에 대해 솔직하게',
      description: '무엇이 암호화되고, 무엇이 되지 않으며, 서버가 무엇을 볼 수 있는지 정확히 공개합니다. 모호함 없이. 비밀 키는 PIN으로 암호화되어 잠금 해제 시에만 메모리에 존재합니다. 메모별 전방 비밀성은 키가 유출되어도 이전 메모를 볼 수 없음을 의미합니다. QR 코드로 새 기기를 안전하게 연결하세요.',
      link: '보안 모델 읽기',
    },
    deploy: {
      heading: '배포할 준비가 되셨나요?',
      description: 'Llámenos는 Docker로 자체 호스팅됩니다 — 모든 것을 직접 제어하세요. 한 시간 이내에 핫라인을 가동하세요.',
      cta: '시작하기',
      github: 'GitHub에서 보기',
    },
  },
  ru: {
    hero: {
      badge: 'Открытый код \u00b7 Сквозное шифрование',
      title: 'Безопасная кризисная горячая линия',
      titleAccent: 'для тех, кому это нужно',
      description: 'Llámenos — это программное обеспечение горячей линии с открытым исходным кодом, защищающее звонящих и волонтёров. Зашифрованные заметки, маршрутизация вызовов в реальном времени и архитектура нулевого знания \u2014 чтобы конфиденциальные разговоры оставались приватными.',
      cta: 'Начать',
      ctaSecondary: 'Прочитать модель безопасности',
    },
    features: {
      heading: 'Создано для реагирования на кризисы',
      subtitle: 'Всё, что нужно горячей линии \u2014 маршрутизация вызовов, зашифрованные заметки, управление сменами и инструменты администрирования \u2014 в одном пакете с открытым кодом.',
      items: [
        { icon: '\u{1F512}', title: 'Заметки со сквозным шифрованием', description: 'Заметки шифруются с прямой секретностью — каждая заметка использует уникальный случайный ключ. Ваш секретный ключ защищён PIN-кодом и никогда не покидает устройство.' },
        { icon: '\u{1F4DE}', title: 'Параллельный вызов', description: 'Входящие звонки одновременно звонят всем волонтёрам на смене. Первый ответивший получает вызов.' },
        { icon: '\u{1F30D}', title: 'Более 12 встроенных языков', description: 'Полные переводы интерфейса: английский, испанский, китайский, тагальский, вьетнамский, арабский, французский, гаитянский креольский, корейский, русский, хинди и португальский.' },
        { icon: '\u{1F399}', title: 'ИИ-транскрипция', description: 'Транскрипция звонков на базе Whisper со сквозным шифрованием. Администратор и волонтёр могут переключать независимо.' },
        { icon: '\u{1F6E1}', title: 'Защита от спама', description: 'Голосовая CAPTCHA, ограничение частоты и списки блокировки в реальном времени. Администраторы переключают защиту без перезапуска.' },
        { icon: '\u{1F4F1}', title: 'PWA с приоритетом мобильных', description: 'Работает на любом устройстве. Устанавливается как приложение. Push-уведомления о входящих звонках.' },
      ],
    },
    security: {
      heading: 'Честно о безопасности',
      description: 'Мы публикуем точно, что зашифровано, что нет, и что видит сервер. Без двусмысленности. Ваш секретный ключ зашифрован PIN-кодом и существует в памяти только при разблокировке. Прямая секретность для каждой заметки означает, что компрометация ключа не раскрывает прошлые заметки. Безопасно привязывайте новые устройства через QR-код.',
      link: 'Прочитать модель безопасности',
    },
    deploy: {
      heading: 'Готовы к развёртыванию?',
      description: 'Llámenos самостоятельно размещается через Docker — вы контролируете всё. Запустите горячую линию менее чем за час.',
      cta: 'Начать',
      github: 'Смотреть на GitHub',
    },
  },
  hi: {
    hero: {
      badge: 'ओपन सोर्स \u00b7 एंड-टू-एंड एन्क्रिप्टेड',
      title: 'सुरक्षित संकट हॉटलाइन',
      titleAccent: 'उन लोगों के लिए जिन्हें इसकी ज़रूरत है',
      description: 'Llámenos एक ओपन-सोर्स हॉटलाइन सॉफ़्टवेयर है जो कॉल करने वालों और स्वयंसेवकों की रक्षा करता है। एन्क्रिप्टेड नोट्स, रियल-टाइम कॉल रूटिंग, और ज़ीरो-नॉलेज आर्किटेक्चर \u2014 ताकि संवेदनशील बातचीत निजी बनी रहे।',
      cta: 'शुरू करें',
      ctaSecondary: 'सुरक्षा मॉडल पढ़ें',
    },
    features: {
      heading: 'संकट प्रतिक्रिया के लिए निर्मित',
      subtitle: 'एक हॉटलाइन को जो कुछ भी चाहिए \u2014 कॉल रूटिंग, एन्क्रिप्टेड नोट-टेकिंग, शिफ़्ट प्रबंधन, और एडमिन टूल्स \u2014 एक ओपन-सोर्स पैकेज में।',
      items: [
        { icon: '\u{1F512}', title: 'एंड-टू-एंड एन्क्रिप्टेड नोट्स', description: 'नोट्स प्रति-नोट फॉरवर्ड सीक्रेसी के साथ एन्क्रिप्ट होते हैं — हर नोट एक अद्वितीय रैंडम कुंजी का उपयोग करता है। आपकी गुप्त कुंजी PIN से सुरक्षित है और कभी आपके डिवाइस से बाहर नहीं जाती।' },
        { icon: '\u{1F4DE}', title: 'समानांतर रिंगिंग', description: 'आने वाली कॉल सभी ड्यूटी पर मौजूद स्वयंसेवकों को एक साथ रिंग करती है। पहले उठाने वाला कॉल प्राप्त करता है।' },
        { icon: '\u{1F30D}', title: '12+ भाषाएँ बिल्ट-इन', description: 'अंग्रेज़ी, स्पेनिश, चीनी, तागालोग, वियतनामी, अरबी, फ़्रेंच, हैतियन क्रियोल, कोरियाई, रूसी, हिंदी और पुर्तगाली के लिए पूर्ण UI अनुवाद।' },
        { icon: '\u{1F399}', title: 'AI ट्रांसक्रिप्शन', description: 'Whisper-संचालित कॉल ट्रांसक्रिप्शन, एंड-टू-एंड एन्क्रिप्शन के साथ। एडमिन और स्वयंसेवक स्वतंत्र रूप से टॉगल कर सकते हैं।' },
        { icon: '\u{1F6E1}', title: 'स्पैम सुरक्षा', description: 'वॉइस CAPTCHA, रेट लिमिटिंग, और रियल-टाइम बैन लिस्ट। एडमिन बिना रीस्टार्ट किए सुरक्षा टॉगल करते हैं।' },
        { icon: '\u{1F4F1}', title: 'मोबाइल-फ़र्स्ट PWA', description: 'किसी भी डिवाइस पर काम करता है। ऐप के रूप में इंस्टॉल करने योग्य। आने वाली कॉल के लिए पुश नोटिफ़िकेशन।' },
      ],
    },
    security: {
      heading: 'सुरक्षा के बारे में ईमानदार',
      description: 'हम सटीक रूप से प्रकाशित करते हैं कि क्या एन्क्रिप्टेड है, क्या नहीं है, और सर्वर क्या देख सकता है। बिना अस्पष्टता के। आपकी गुप्त कुंजी PIN से एन्क्रिप्टेड है और अनलॉक होने पर केवल मेमोरी में रहती है। प्रति-नोट फॉरवर्ड सीक्रेसी का अर्थ है कि कुंजी से समझौता पिछले नोट्स को प्रकट नहीं करता। QR कोड से नए डिवाइस सुरक्षित रूप से लिंक करें।',
      link: 'सुरक्षा मॉडल पढ़ें',
    },
    deploy: {
      heading: 'तैनात करने के लिए तैयार?',
      description: 'Llámenos Docker के माध्यम से स्वयं-होस्ट किया जाता है — आप सब कुछ नियंत्रित करते हैं। एक घंटे से कम में हॉटलाइन शुरू करें।',
      cta: 'शुरू करें',
      github: 'GitHub पर देखें',
    },
  },
  pt: {
    hero: {
      badge: 'Código aberto \u00b7 Criptografia de ponta a ponta',
      title: 'Linha de crise segura',
      titleAccent: 'para quem precisa',
      description: 'O Llámenos é um software de linha de ajuda de código aberto que protege quem liga e voluntários. Notas criptografadas, roteamento de chamadas em tempo real e arquitetura de conhecimento zero \u2014 para que conversas sensíveis permaneçam privadas.',
      cta: 'Começar',
      ctaSecondary: 'Ler o modelo de segurança',
    },
    features: {
      heading: 'Construído para resposta a crises',
      subtitle: 'Tudo que uma linha de ajuda precisa \u2014 roteamento de chamadas, notas criptografadas, gestão de turnos e ferramentas de administração \u2014 em um único pacote de código aberto.',
      items: [
        { icon: '\u{1F512}', title: 'Notas com criptografia de ponta a ponta', description: 'As notas são criptografadas com sigilo direto por nota — cada nota usa uma chave aleatória única. Sua chave secreta é protegida por PIN e nunca sai do seu dispositivo.' },
        { icon: '\u{1F4DE}', title: 'Toque paralelo', description: 'Chamadas recebidas tocam simultaneamente para todos os voluntários em turno. O primeiro a atender recebe a chamada.' },
        { icon: '\u{1F30D}', title: 'Mais de 12 idiomas integrados', description: 'Traduções completas da interface para inglês, espanhol, chinês, tagalo, vietnamita, árabe, francês, crioulo haitiano, coreano, russo, hindi e português.' },
        { icon: '\u{1F399}', title: 'Transcrição com IA', description: 'Transcrição de chamadas com Whisper e criptografia de ponta a ponta. Administrador e voluntário podem alternar independentemente.' },
        { icon: '\u{1F6E1}', title: 'Proteção contra spam', description: 'CAPTCHA de voz, limitação de taxa e listas de bloqueio em tempo real. Administradores alternam proteções sem reiniciar.' },
        { icon: '\u{1F4F1}', title: 'PWA mobile first', description: 'Funciona em qualquer dispositivo. Instalável como aplicativo. Notificações push para chamadas recebidas.' },
      ],
    },
    security: {
      heading: 'Honestos sobre segurança',
      description: 'Publicamos exatamente o que está criptografado, o que não está e o que o servidor pode ver. Sem ambiguidade. Sua chave secreta é criptografada por PIN e existe apenas na memória quando desbloqueada. O sigilo direto por nota significa que comprometer uma chave não revela notas anteriores. Vincule novos dispositivos com segurança via código QR.',
      link: 'Ler o modelo de segurança',
    },
    deploy: {
      heading: 'Pronto para implantar?',
      description: 'O Llámenos é auto-hospedado via Docker — você controla tudo. Coloque uma linha de ajuda em funcionamento em menos de uma hora.',
      cta: 'Começar',
      github: 'Ver no GitHub',
    },
  },
  de: {
    hero: {
      badge: 'Open Source \u00b7 Ende-zu-Ende-verschlüsselt',
      title: 'Sichere Krisenhotline',
      titleAccent: 'für die Menschen, die sie brauchen',
      description: 'Llámenos ist eine Open-Source-Hotline-Software, die Anrufer und Freiwillige schützt. Verschlüsselte Notizen, Echtzeit-Anrufweiterleitung und eine Zero-Knowledge-Architektur \u2014 damit sensible Gespräche privat bleiben.',
      cta: 'Erste Schritte',
      ctaSecondary: 'Sicherheitsmodell lesen',
    },
    features: {
      heading: 'Für Krisenreaktion entwickelt',
      subtitle: 'Alles, was eine Hotline braucht \u2014 Anrufweiterleitung, verschlüsselte Notizen, Schichtmanagement und Admin-Tools \u2014 in einem einzigen Open-Source-Paket.',
      items: [
        { icon: '\u{1F512}', title: 'Ende-zu-Ende-verschlüsselte Notizen', description: 'Notizen werden mit Perfect Forward Secrecy pro Notiz verschlüsselt — jede Notiz verwendet einen einzigartigen Zufallsschlüssel. Ihr geheimer Schlüssel ist PIN-geschützt und verlässt nie Ihr Gerät.' },
        { icon: '\u{1F4DE}', title: 'Paralleles Klingeln', description: 'Eingehende Anrufe klingeln gleichzeitig bei allen diensthabenden Freiwilligen. Wer zuerst abnimmt, erhält den Anruf.' },
        { icon: '\u{1F30D}', title: 'Über 12 integrierte Sprachen', description: 'Vollständige UI-Übersetzungen für Englisch, Spanisch, Chinesisch, Tagalog, Vietnamesisch, Arabisch, Französisch, Haitianisches Kreol, Koreanisch, Russisch, Hindi und Portugiesisch.' },
        { icon: '\u{1F399}', title: 'KI-Transkription', description: 'Whisper-basierte Anruftranskription mit Ende-zu-Ende-Verschlüsselung. Administrator und Freiwillige können unabhängig umschalten.' },
        { icon: '\u{1F6E1}', title: 'Spam-Schutz', description: 'Sprach-CAPTCHA, Ratenbegrenzung und Echtzeit-Sperrlisten. Administratoren schalten Schutzmaßnahmen ohne Neustart um.' },
        { icon: '\u{1F4F1}', title: 'Mobile-first PWA', description: 'Funktioniert auf jedem Gerät. Als App installierbar. Push-Benachrichtigungen für eingehende Anrufe.' },
      ],
    },
    security: {
      heading: 'Ehrlich über Sicherheit',
      description: 'Wir veröffentlichen genau, was verschlüsselt ist, was nicht und was der Server sehen kann. Ohne Verschleierung. Ihr geheimer Schlüssel ist PIN-verschlüsselt und existiert nur im Speicher, wenn er entsperrt ist. Perfect Forward Secrecy pro Notiz bedeutet, dass ein kompromittierter Schlüssel vergangene Notizen nicht preisgibt. Verknüpfen Sie neue Geräte sicher per QR-Code.',
      link: 'Sicherheitsmodell lesen',
    },
    deploy: {
      heading: 'Bereit zur Bereitstellung?',
      description: 'Llámenos wird selbst gehostet über Docker — Sie kontrollieren alles. Starten Sie eine Hotline in weniger als einer Stunde.',
      cta: 'Erste Schritte',
      github: 'Auf GitHub ansehen',
    },
  },
  uk: {
    hero: {
      badge: 'Відкритий код \u00b7 Наскрізне шифрування',
      title: 'Безпечна кризова гаряча лінія',
      titleAccent: 'для тих, хто потребує допомоги',
      description: 'Llámenos \u2014 це програмне забезпечення гарячої лінії з відкритим кодом, що захищає абонентів та волонтерів. Зашифровані нотатки, маршрутизація дзвінків у реальному часі та архітектура нульового знання \u2014 щоб конфіденційні розмови залишалися приватними.',
      cta: 'Почати',
      ctaSecondary: 'Прочитати модель безпеки',
    },
    features: {
      heading: 'Створено для реагування на кризи',
      subtitle: 'Усе, що потрібно гарячій лінії \u2014 маршрутизація дзвінків, зашифровані нотатки, управління змінами та інструменти адміністратора \u2014 в одному пакеті з відкритим кодом.',
      items: [
        { icon: '\u{1F512}', title: 'Нотатки з наскрізним шифруванням', description: 'Нотатки шифруються з прямою секретністю \u2014 кожна нотатка використовує унікальний випадковий ключ. Ваш секретний ключ захищений PIN-кодом і ніколи не покидає ваш пристрій.' },
        { icon: '\u{1F4DE}', title: 'Паралельний виклик', description: 'Вхідні дзвінки одночасно дзвонять усім волонтерам на зміні. Перший, хто відповів, отримує дзвінок.' },
        { icon: '\u{1F30D}', title: 'Понад 12 вбудованих мов', description: 'Повні переклади інтерфейсу: англійська, іспанська, китайська, тагальська, в\'єтнамська, арабська, французька, гаїтянська креольська, корейська, російська, гінді та португальська.' },
        { icon: '\u{1F399}', title: 'ШІ-транскрипція', description: 'Транскрипція дзвінків на основі Whisper з наскрізним шифруванням. Адміністратор і волонтер можуть перемикати незалежно.' },
        { icon: '\u{1F6E1}', title: 'Захист від спаму', description: 'Голосова CAPTCHA, обмеження частоти та списки блокування в реальному часі. Адміністратори перемикають захист без перезапуску.' },
        { icon: '\u{1F4F1}', title: 'Mobile-first PWA', description: 'Працює на будь-якому пристрої. Встановлюється як додаток. Push-сповіщення про вхідні дзвінки.' },
      ],
    },
    security: {
      heading: 'Чесно про безпеку',
      description: 'Ми публікуємо точно, що зашифровано, що ні, і що може бачити сервер. Без натяків. Ваш секретний ключ зашифрований PIN-кодом і існує в пам\'яті лише при розблокуванні. Пряма секретність для кожної нотатки означає, що компрометація ключа не розкриває попередні нотатки. Безпечно прив\'язуйте нові пристрої через QR-код.',
      link: 'Прочитати модель безпеки',
    },
    deploy: {
      heading: 'Готові до розгортання?',
      description: 'Llámenos розгортається самостійно через Docker \u2014 ви контролюєте все. Запустіть гарячу лінію менш ніж за годину.',
      cta: 'Почати',
      github: 'Переглянути на GitHub',
    },
  },
  fa: {
    hero: {
      badge: 'متن\u200Cباز \u00b7 رمزنگاری سرتاسری',
      title: 'خط بحران امن',
      titleAccent: 'برای کسانی که به آن نیاز دارند',
      description: 'Llámenos یک نرم\u200Cافزار خط بحران متن\u200Cباز است که از تماس\u200Cگیرندگان و داوطلبان محافظت می\u200Cکند. یادداشت\u200Cهای رمزنگاری\u200Cشده، مسیریابی تماس بلادرنگ و معماری دانش\u200Cصفر \u2014 تا مکالمات حساس خصوصی بمانند.',
      cta: 'شروع کنید',
      ctaSecondary: 'مدل امنیتی را بخوانید',
    },
    features: {
      heading: 'ساخته\u200Cشده برای پاسخ به بحران',
      subtitle: 'هر آنچه یک خط بحران نیاز دارد \u2014 مسیریابی تماس، یادداشت\u200Cبرداری رمزنگاری\u200Cشده، مدیریت شیفت و ابزارهای مدیریت \u2014 در یک بسته متن\u200Cباز.',
      items: [
        { icon: '\u{1F512}', title: 'یادداشت\u200Cهای رمزنگاری سرتاسری', description: 'یادداشت\u200Cها با محرمانگی پیشرو رمزنگاری می\u200Cشوند \u2014 هر یادداشت از یک کلید تصادفی منحصربه\u200Cفرد استفاده می\u200Cکند. کلید محرمانه شما با PIN محافظت شده و هرگز دستگاه شما را ترک نمی\u200Cکند.' },
        { icon: '\u{1F4DE}', title: 'زنگ موازی', description: 'تماس\u200Cهای ورودی همزمان برای تمام داوطلبان در شیفت زنگ می\u200Cزنند. اولین نفری که پاسخ دهد تماس را دریافت می\u200Cکند.' },
        { icon: '\u{1F30D}', title: 'بیش از ۱۲ زبان داخلی', description: 'ترجمه\u200Cهای کامل رابط کاربری برای انگلیسی، اسپانیایی، چینی، تاگالوگ، ویتنامی، عربی، فرانسوی، کریول هائیتی، کره\u200Cای، روسی، هندی و پرتغالی.' },
        { icon: '\u{1F399}', title: 'رونویسی هوش مصنوعی', description: 'رونویسی تماس با Whisper و رمزنگاری سرتاسری. مدیر و داوطلب می\u200Cتوانند به\u200Cصورت مستقل فعال/غیرفعال کنند.' },
        { icon: '\u{1F6E1}', title: 'مقابله با هرزنامه', description: 'CAPTCHA صوتی، محدودیت نرخ و لیست\u200Cهای مسدودسازی بلادرنگ. مدیران بدون راه\u200Cاندازی مجدد محافظت\u200Cها را تغییر می\u200Cدهند.' },
        { icon: '\u{1F4F1}', title: 'PWA اول\u200Cموبایل', description: 'روی هر دستگاهی کار می\u200Cکند. به\u200Cعنوان برنامه نصب\u200Cشدنی است. اعلان\u200Cهای فوری برای تماس\u200Cهای ورودی.' },
      ],
    },
    security: {
      heading: 'صادقانه درباره امنیت',
      description: 'ما دقیقا منتشر می\u200Cکنیم که چه چیزی رمزنگاری شده، چه چیزی نشده و سرور چه چیزی می\u200Cتواند ببیند. بدون ابهام. کلید محرمانه شما با PIN رمزنگاری شده و فقط هنگام باز بودن قفل در حافظه وجود دارد. محرمانگی پیشرو هر یادداشت به این معنی است که لو رفتن کلید یادداشت\u200Cهای قبلی را فاش نمی\u200Cکند. دستگاه\u200Cهای جدید را با کد QR به\u200Cصورت امن متصل کنید.',
      link: 'مدل امنیتی را بخوانید',
    },
    deploy: {
      heading: 'آماده استقرار هستید؟',
      description: 'Llámenos به\u200Cصورت خود\u200Cمیزبان از طریق Docker اجرا می\u200Cشود \u2014 شما همه چیز را کنترل می\u200Cکنید. در کمتر از یک ساعت خط بحران را راه\u200Cاندازی کنید.',
      cta: 'شروع کنید',
      github: 'مشاهده در GitHub',
    },
  },
  tr: {
    hero: {
      badge: 'A\u00e7\u0131k kaynak \u00b7 U\u00e7tan uca \u015fifreleme',
      title: 'G\u00fcvenli kriz hatt\u0131',
      titleAccent: 'ihtiyac\u0131 olan insanlar i\u00e7in',
      description: 'Ll\u00e1menos, arayanlari ve g\u00f6n\u00fcll\u00fcleri koruyan a\u00e7\u0131k kaynakl\u0131 kriz hatt\u0131 yaz\u0131l\u0131m\u0131d\u0131r. \u015eifreli notlar, ger\u00e7ek zamanl\u0131 \u00e7a\u011fr\u0131 y\u00f6nlendirme ve s\u0131f\u0131r bilgi mimarisi \u2014 hassas konu\u015fmalar\u0131n gizli kalmas\u0131 i\u00e7in.',
      cta: 'Ba\u015fla',
      ctaSecondary: 'G\u00fcvenlik modelini oku',
    },
    features: {
      heading: 'Kriz m\u00fcdahalesi i\u00e7in tasarland\u0131',
      subtitle: 'Bir kriz hatt\u0131n\u0131n ihtiyac\u0131 olan her \u015fey \u2014 \u00e7a\u011fr\u0131 y\u00f6nlendirme, \u015fifreli not tutma, vardiya y\u00f6netimi ve y\u00f6netici ara\u00e7lar\u0131 \u2014 tek bir a\u00e7\u0131k kaynak paketinde.',
      items: [
        { icon: '\u{1F512}', title: 'U\u00e7tan uca \u015fifreli notlar', description: 'Notlar, not ba\u015f\u0131na ileri gizlilik ile \u015fifrelenir \u2014 her not benzersiz bir rastgele anahtar kullan\u0131r. Gizli anahtar\u0131n\u0131z PIN ile korunur ve cihaz\u0131n\u0131zdan asla ayr\u0131lmaz.' },
        { icon: '\u{1F4DE}', title: 'Paralel \u00e7ald\u0131rma', description: 'Gelen \u00e7a\u011fr\u0131lar, vardiyadaki t\u00fcm g\u00f6n\u00fcll\u00fcleri ayn\u0131 anda \u00e7ald\u0131r\u0131r. \u0130lk a\u00e7an ki\u015fi \u00e7a\u011fr\u0131y\u0131 al\u0131r.' },
        { icon: '\u{1F30D}', title: '12\'den fazla yerle\u015fik dil', description: '\u0130ngilizce, \u0130spanyolca, \u00c7ince, Tagalogca, Vietnamca, Arap\u00e7a, Frans\u0131zca, Haiti Kreyolu, Korece, Rus\u00e7a, Hintçe ve Portekizce i\u00e7in tam aray\u00fcz \u00e7evirileri.' },
        { icon: '\u{1F399}', title: 'Yapay zeka transkripsiyonu', description: 'U\u00e7tan uca \u015fifreleme ile Whisper tabanl\u0131 \u00e7a\u011fr\u0131 transkripsiyonu. Y\u00f6netici ve g\u00f6n\u00fcll\u00fc ba\u011f\u0131ms\u0131z olarak a\u00e7\u0131p kapatabilir.' },
        { icon: '\u{1F6E1}', title: 'Spam korumas\u0131', description: 'Sesli CAPTCHA, h\u0131z s\u0131n\u0131rlama ve ger\u00e7ek zamanl\u0131 yasaklama listeleri. Y\u00f6neticiler yeniden ba\u015flatmadan korumalar\u0131 de\u011fi\u015ftirir.' },
        { icon: '\u{1F4F1}', title: 'Mobil \u00f6ncelikli PWA', description: 'Her cihazda \u00e7al\u0131\u015f\u0131r. Uygulama olarak y\u00fcklenebilir. Gelen \u00e7a\u011fr\u0131lar i\u00e7in push bildirimleri.' },
      ],
    },
    security: {
      heading: 'G\u00fcvenlik konusunda d\u00fcr\u00fcst',
      description: 'Neyin \u015fifreli oldu\u011funu, neyin olmad\u0131\u011f\u0131n\u0131 ve sunucunun neler g\u00f6rebildi\u011fini tam olarak yay\u0131nl\u0131yoruz. Belirsizlik yok. Gizli anahtar\u0131n\u0131z PIN ile \u015fifrelenir ve yaln\u0131zca kilit a\u00e7\u0131kken bellekte bulunur. Not ba\u015f\u0131na ileri gizlilik, bir anahtar\u0131n ele ge\u00e7irilmesinin ge\u00e7mi\u015f notlar\u0131 a\u00e7\u0131\u011fa \u00e7\u0131karamayaca\u011f\u0131 anlam\u0131na gelir. QR kodu ile yeni cihazlar\u0131 g\u00fcvenli bir \u015fekilde ba\u011flay\u0131n.',
      link: 'G\u00fcvenlik modelini oku',
    },
    deploy: {
      heading: 'Da\u011f\u0131t\u0131ma haz\u0131r m\u0131s\u0131n\u0131z?',
      description: 'Ll\u00e1menos, Docker \u00fczerinden kendi sunucunuzda bar\u0131nd\u0131r\u0131l\u0131r \u2014 her \u015feyi siz kontrol edersiniz. Bir saatten k\u0131sa s\u00fcrede bir kriz hatt\u0131 ba\u015flat\u0131n.',
      cta: 'Ba\u015fla',
      github: 'GitHub\'da g\u00f6r\u00fcnt\u00fcle',
    },
  },
  ku: {
    hero: {
      badge: '\u00c7avkaniya vekirî \u00b7 \u015eifrekirina ji serî heta dawiyê',
      title: 'Xeta krîzê ya ewle',
      titleAccent: 'ji bo kesên ku hewceyê wê ne',
      description: 'Ll\u00e1menos nermalava xeta krîzê ya \u00e7avkaniya vekirî ye ku gazîkeran û dilxwazan dipar\u00eaze. Notên \u015eifrekirî, r\u00eakirina bangehê di wextê rastîn de û m\u0131mariya zanîna sifir \u2014 da ku axaftinên hestiyar taybetî bimînin.',
      cta: 'Dest pê bike',
      ctaSecondary: 'Modela ewlehiyê bixwîne',
    },
    features: {
      heading: 'Ji bo bersiva krîzê hatiye çêkirin',
      subtitle: 'Her tiştê ku xetek krîzê hewce dike \u2014 r\u00eakirina bangeh\u00ea, notên \u015eifrekirî, birêvebirina nobeyê û amûrên rêvebiriyê \u2014 di pakêtek \u00e7avkaniya vekirî de.',
      items: [
        { icon: '\u{1F512}', title: 'Notên \u015eifrekirî ji serî heta dawiyê', description: 'Not bi nehêniya pê\u015fverû ji bo her notê tên \u015eifrekirin \u2014 her not mifteyek rasthatî ya bêhempa bi kar tîne. Mifteya te ya nehênî bi PIN tê par\u00eastin û tu car amûra te bernade.' },
        { icon: '\u{1F4DE}', title: 'Zengkirina paralel', description: 'Bangên hat\u00ee hemû dilxwazên li ser nobeyê bi hev re diz\u00eanginin. Yê yekem bersiv bide bang\u00ea werdigire.' },
        { icon: '\u{1F30D}', title: 'Zêdetir ji 12 zimanên çêkirî', description: 'Werger\u00ean tam\u00ea UI ji bo Îngilîzî, Spanî, Çînî, Tagalog, Viyetnamî, Erebî, Fransî, Kreola Haîtî, Koreyî, Rûsî, Hindî û Portûgalî.' },
        { icon: '\u{1F399}', title: 'Transkripsiyona AI', description: 'Transkripsiyona bangê bi Whisper bi \u015eifrekirin ji serî heta dawiyê. Rêvebir û dilxwaz dikarin serbixwe veguherînin.' },
        { icon: '\u{1F6E1}', title: 'Parastina li hember spam', description: 'CAPTCHA-ya dengan, sînorkirina rêjeyê û lîsteyên qedexekirinê yên wextê rastîn. Rêvebir bêyî ji nû ve destpêkirinê parastan diguherînin.' },
        { icon: '\u{1F4F1}', title: 'PWA mobîl-pêşîn', description: 'Li ser her amûrê dixebite. Wek sepanê tê saz kirin. Agahdariyên push ji bo bangên hat\u00ee.' },
      ],
    },
    security: {
      heading: 'Rast derbarê ewlehiyê',
      description: 'Em tam di\u015eîn ku \u00e7i \u015eifrekir\u00ee ye, \u00e7i n\u00eaye û server dikare \u00e7i bibîne. Bêyî nenas\u00ee. Mifteya te ya nehênî bi PIN \u015eifrekir\u00ee ye û tenê dema vekirî di bîranînê de heye. Nehêniya pê\u015fverû ji bo her notê t\u00eaye wê wateyê ku ger mifteyek were girtin notên berê eşkere nabe. Amûrên nû bi ewlehî bi koda QR ve girêbide.',
      link: 'Modela ewlehiyê bixwîne',
    },
    deploy: {
      heading: 'Ji bo bicihkirinê amade ye?',
      description: 'Ll\u00e1menos bi Docker-ê xwe-mêvandar dibe \u2014 tu her tiştî kontrol dikî. Di kêmtirî saetekê de xetekê krîzê dest pê bike.',
      cta: 'Dest pê bike',
      github: 'Li ser GitHub-ê bibîne',
    },
  },
  so: {
    hero: {
      badge: 'Isha furan \u00b7 Sir-daamin dhamaad-ilaa-dhamaad',
      title: 'Khadka xasaasiyadda ee ammaan',
      titleAccent: 'dadka u baahan',
      description: 'Llámenos waa barnaamij khadka xasaasiyadda oo ah isha furan oo ilaaliya wacayaasha iyo mutadawwiciinta. Qoraallo sir ah, hagaajinta wacitaannada waqtiga dhabta ah iyo qaab-dhismeedka aqoonta eber ah \u2014 si wadahadallooyinka xasaasiga ahi u ahaadaan kuwo gaar ah.',
      cta: 'Bilow',
      ctaSecondary: 'Akhri qaabka amniga',
    },
    features: {
      heading: 'Loo dhisay jawaabta xasaasiyadda',
      subtitle: 'Wax kasta oo khadka xasaasiyaddu u baahan yahay \u2014 hagaajinta wacitaannada, qoraalada sir ah, maaraynta wareegga iyo qalabka maamulka \u2014 hal xirmo isha furan ah.',
      items: [
        { icon: '\u{1F512}', title: 'Qoraallo sir-daamin dhamaad-ilaa-dhamaad', description: 'Qoraalada waxaa lagu sir-daamiyaa sir horumarsan oo qoraal kasta \u2014 qoraal kasta wuxuu isticmaalaa fure random ah oo gaar ah. Furahaaga sirta ah waxaa ilaaliya PIN mana ka baxdo qalabkaaga.' },
        { icon: '\u{1F4DE}', title: 'Garaacid isku mar ah', description: 'Wacitaannada soo galaya ayaa isku mar u garaacaya dhammaan mutadawwiciinta wareegga ku jira. Kan ugu horreeya ee jawaaba wuxuu helayaa wacitaanka.' },
        { icon: '\u{1F30D}', title: 'In ka badan 12 luqadood oo ku dhisan', description: 'Turjumaaddo buuxa oo UI ah oo loogu talagalay Ingiriis, Isbaanish, Shiine, Tagalog, Fiyetnaamiis, Carabi, Faransiis, Kreole Haitiyaan, Kuuriyaan, Ruush, Hindi, iyo Bortaqiis.' },
        { icon: '\u{1F399}', title: 'Qoraal-u-rogid AI', description: 'Qoraal-u-rogidda wacitaannada ee Whisper leh sir-daamin dhamaad-ilaa-dhamaad. Maamulaha iyo mutadawwiciga ayaa si madaxbannaan ah u beddeli kara.' },
        { icon: '\u{1F6E1}', title: 'Ilaalinta spam-ka', description: 'CAPTCHA codka, xaddidaadda heerka iyo liisaska mamnuucidda waqtiga dhabta ah. Maamulayaashu waxay beddelaan ilaalinta iyagoo dib u bilaabin.' },
        { icon: '\u{1F4F1}', title: 'PWA mobilka horreeya', description: 'Waxay ku shaqaysaa qalab kasta. Sida app ahaan loo dhigi karaa. Ogeysiisyada push ee wacitaannada soo galaya.' },
      ],
    },
    security: {
      heading: 'Daacad ku saabsan amniga',
      description: 'Waxaan si sax ah u daabacnaa waxa la sir-daamiyay, waxa aan la sir-daaminin iyo waxa server-ku arki karo. Wax qarsoon la\'aan. Furahaaga sirta ah waxaa lagu sir-daamiyay PIN wuxuuna ku jiraa xusuusta oo keliya marka la furo. Sir horumarsan oo qoraal kasta macnaheedu waa in la helo fure qoraallada hore ma muujiyo. Qalabyo cusub si ammaan ah ugu xidh QR code.',
      link: 'Akhri qaabka amniga',
    },
    deploy: {
      heading: 'U diyaar tahay hawlgelinta?',
      description: 'Llámenos waa mid uu qofku iskiis u martigelin karo Docker \u2014 adiga ayaa wax walba xakameynaya. Ku bilow khadka xasaasiyadda in ka yar hal saac.',
      cta: 'Bilow',
      github: 'Ka arag GitHub',
    },
  },
  am: {
    hero: {
      badge: 'ክፍት ምንጭ \u00b7 ከጫፍ እስከ ጫፍ ምስጠራ',
      title: 'ደህንነቱ የተጠበቀ የቀውስ ሆትላይን',
      titleAccent: 'ለሚያስፈልጋቸው ሰዎች',
      description: 'Llámenos ደዋዮችን እና በጎ ፈቃደኞችን የሚጠብቅ ክፍት ምንጭ የሆትላይን ሶፍትዌር ነው። ምስጢራዊ ማስታወሻዎች፣ በእውነተኛ ጊዜ የጥሪ ማዘዋወር እና ዜሮ-እውቀት ስነ-ህንፃ \u2014 ስሱ ንግግሮች የግል ሆነው እንዲቆዩ።',
      cta: 'መጀመር',
      ctaSecondary: 'የደህንነት ሞዴሉን ያንብቡ',
    },
    features: {
      heading: 'ለቀውስ ምላሽ የተገነባ',
      subtitle: 'ሆትላይን የሚፈልገው ሁሉ \u2014 የጥሪ ማዘዋወር፣ ምስጢራዊ ማስታወሻ መያዝ፣ የፈረቃ አስተዳደር እና የአስተዳዳሪ መሳሪያዎች \u2014 በአንድ ክፍት ምንጭ ጥቅል ውስጥ።',
      items: [
        { icon: '\u{1F512}', title: 'ከጫፍ እስከ ጫፍ ምስጠራ ያላቸው ማስታወሻዎች', description: 'ማስታወሻዎች በእያንዳንዱ ማስታወሻ ወደፊት ምስጢራዊነት ይመሰጥራሉ \u2014 እያንዳንዱ ማስታወሻ ልዩ የዘፈቀደ ቁልፍ ይጠቀማል። ሚስጥራዊ ቁልፍዎ በPIN የተጠበቀ ሲሆን መሳሪያዎን ፈጽሞ አይለቅም።' },
        { icon: '\u{1F4DE}', title: 'ትይዩ ጥሪ', description: 'ገቢ ጥሪዎች በፈረቃ ላይ ያሉ ሁሉንም በጎ ፈቃደኞች በአንድ ጊዜ ያስደውላሉ። መጀመሪያ ያነሳው ጥሪውን ይቀበላል።' },
        { icon: '\u{1F30D}', title: 'ከ12 በላይ ቋንቋዎች አብሮ የተሰሩ', description: 'ለእንግሊዝኛ፣ ስፓኒሽ፣ ቻይንኛ፣ ታጋሎግ፣ ቬትናምኛ፣ ዓረብኛ፣ ፈረንሳይኛ፣ ሃይቲ ክሪኦል፣ ኮሪያኛ፣ ሩሲያኛ፣ ሂንዲ እና ፖርቱጋልኛ ሙሉ UI ትርጉሞች።' },
        { icon: '\u{1F399}', title: 'AI ግልባጭ', description: 'ከጫፍ እስከ ጫፍ ምስጠራ ያለው Whisper-ተኮ የጥሪ ግልባጭ። አስተዳዳሪ እና በጎ ፈቃደኛ በነጻ ማብራት/ማጥፋት ይችላሉ።' },
        { icon: '\u{1F6E1}', title: 'ስፓም ጥበቃ', description: 'የድምፅ CAPTCHA፣ የፍጥነት ገደብ እና በእውነተኛ ጊዜ የማገጃ ዝርዝሮች። አስተዳዳሪዎች ያለ ዳግም ማስጀመር ጥበቃዎችን ይቀይራሉ።' },
        { icon: '\u{1F4F1}', title: 'ሞባይል-ቅድሚያ PWA', description: 'በማንኛውም መሳሪያ ላይ ይሰራል። እንደ መተግበሪያ ሊጫን ይችላል። ለገቢ ጥሪዎች የPush ማሳወቂያዎች።' },
      ],
    },
    security: {
      heading: 'ስለ ደህንነት ታማኝ',
      description: 'ምን እንደተመሰጠረ፣ ምን እንዳልተመሰጠረ እና አገልጋዩ ምን ማየት እንደሚችል በትክክል እናሳትማለን። ግልጽነት ብቻ። ሚስጥራዊ ቁልፍዎ በPIN ተመስጥሮ በማስታወሻ ውስጥ ብቻ ሲከፈት ይኖራል። የእያንዳንዱ ማስታወሻ ወደፊት ምስጢራዊነት ማለት ቁልፍ መጥፋት ያለፉ ማስታወሻዎችን አያሳይም። አዲስ መሳሪያዎችን በQR ኮድ በደህንነት ያገናኙ።',
      link: 'የደህንነት ሞዴሉን ያንብቡ',
    },
    deploy: {
      heading: 'ለማሰማራት ዝግጁ ነዎት?',
      description: 'Llámenos በDocker በኩል በራስ-ማስተናገድ ነው \u2014 ሁሉንም ነገር እርስዎ ይቆጣጠራሉ። በአንድ ሰዓት ውስጥ ሆትላይን ያስጀምሩ።',
      cta: 'መጀመር',
      github: 'በGitHub ላይ ይመልከቱ',
    },
  },
  my: {
    hero: {
      badge: 'အခမဲ့ ရင်းမြစ်ဖွင့် \u00b7 အစမှအဆုံး ကုဒ်ဝှက်ခြင်း',
      title: 'လုံခြုံသော အကျပ်အတည်း ဟော့တ်လိုင်း',
      titleAccent: 'လိုအပ်သူများအတွက်',
      description: 'Llámenos သည် ခေါ်ဆိုသူများနှင့် စေတနာ့ဝန်ထမ်းများကို ကာကွယ်ပေးသည့် အခမဲ့ ရင်းမြစ်ဖွင့် ဟော့တ်လိုင်း ဆော့ဖ်ဝဲဖြစ်သည်။ ကုဒ်ဝှက်ထားသော မှတ်စုများ၊ အချိန်နှင့်တစ်ပြေးညီ ခေါ်ဆိုမှု လမ်းကြောင်းပြောင်းခြင်းနှင့် သုညအသိပညာ ဗိသုကာ \u2014 အရေးကြီးသော စကားပြောဆိုမှုများ လျှို့ဝှက်စွာ ရှိနေစေရန်။',
      cta: 'စတင်ရန်',
      ctaSecondary: 'လုံခြုံရေး မော်ဒယ်ကို ဖတ်ပါ',
    },
    features: {
      heading: 'အကျပ်အတည်း တုံ့ပြန်မှုအတွက် တည်ဆောက်ထားသည်',
      subtitle: 'ဟော့တ်လိုင်းတစ်ခု လိုအပ်သမျှ \u2014 ခေါ်ဆိုမှု လမ်းကြောင်းပြောင်းခြင်း၊ ကုဒ်ဝှက်ထားသော မှတ်စုယူခြင်း၊ အလှည့်ကျစီမံခန့်ခွဲမှုနှင့် စီမံခန့်ခွဲသူ ကိရိယာများ \u2014 အခမဲ့ ရင်းမြစ်ဖွင့် ပက်ကေ့ချ်တစ်ခုတည်းတွင်။',
      items: [
        { icon: '\u{1F512}', title: 'အစမှအဆုံး ကုဒ်ဝှက်ထားသော မှတ်စုများ', description: 'မှတ်စုများကို မှတ်စုတစ်ခုချင်းစီ ရှေ့သို့လျှို့ဝှက်မှုဖြင့် ကုဒ်ဝှက်ထားသည် \u2014 မှတ်စုတိုင်းတွင် ထူးခြားသော ကျပန်းသော့ကို အသုံးပြုသည်။ သင့်လျှို့ဝှက်သော့ကို PIN ဖြင့် ကာကွယ်ထားပြီး သင့်စက်ပစ္စည်းမှ ဘယ်တော့မှ မထွက်ပါ။' },
        { icon: '\u{1F4DE}', title: 'တစ်ပြိုင်နက် ခေါ်ဆိုခြင်း', description: 'ဝင်လာသော ခေါ်ဆိုမှုများသည် အလှည့်ကျရှိ စေတနာ့ဝန်ထမ်းအားလုံးကို တစ်ပြိုင်နက် ခေါ်ဆိုသည်။ ပထမဆုံး ကောက်ယူသူ ခေါ်ဆိုမှုကို ရရှိသည်။' },
        { icon: '\u{1F30D}', title: 'ဘာသာစကား ၁၂ ခုကျော် ပါဝင်', description: 'အင်္ဂလိပ်၊ စပိန်၊ တရုတ်၊ တဂါလော့၊ ဗီယက်နမ်၊ အာရပ်၊ ပြင်သစ်၊ ဟေတီ ခရီးအိုး၊ ကိုရီးယား၊ ရုရှား၊ ဟိန္ဒီနှင့် ပေါ်တူဂီ အတွက် UI ဘာသာပြန်ချက်အပြည့်အစုံ။' },
        { icon: '\u{1F399}', title: 'AI မှတ်တမ်းတင်ခြင်း', description: 'အစမှအဆုံး ကုဒ်ဝှက်ခြင်းပါ Whisper အခြေပြု ခေါ်ဆိုမှု မှတ်တမ်းတင်ခြင်း။ စီမံခန့်ခွဲသူနှင့် စေတနာ့ဝန်ထမ်း လွတ်လပ်စွာ ပြောင်းလဲနိုင်သည်။' },
        { icon: '\u{1F6E1}', title: 'စပမ် ကာကွယ်မှု', description: 'အသံ CAPTCHA၊ နှုန်းကန့်သတ်ခြင်းနှင့် အချိန်နှင့်တစ်ပြေးညီ ပိတ်ပင်စာရင်းများ။ စီမံခန့်ခွဲသူများ ပြန်လည်စတင်ခြင်းမရှိဘဲ ကာကွယ်မှုများကို ပြောင်းလဲနိုင်သည်။' },
        { icon: '\u{1F4F1}', title: 'မိုဘိုင်းဦးစားပေး PWA', description: 'မည်သည့်စက်ပစ္စည်းတွင်မဆို အလုပ်လုပ်သည်။ အက်ပ်အဖြစ် ထည့်သွင်းနိုင်သည်။ ဝင်လာသော ခေါ်ဆိုမှုများအတွက် Push အသိပေးချက်များ။' },
      ],
    },
    security: {
      heading: 'လုံခြုံရေးအကြောင်း ရိုးသားစွာ',
      description: 'ဘာကို ကုဒ်ဝှက်ထားသည်၊ ဘာကို မဝှက်ထား၊ ဆာဗာက ဘာကို မြင်နိုင်သည်ကို အတိအကျ ထုတ်ဝေသည်။ မရှင်းလင်းမှု မရှိ။ သင့်လျှို့ဝှက်သော့ကို PIN ဖြင့် ကုဒ်ဝှက်ထားပြီး သော့ဖွင့်ထားချိန်တွင်သာ မှတ်ဉာဏ်တွင် ရှိသည်။ မှတ်စုတစ်ခုချင်းစီ ရှေ့သို့လျှို့ဝှက်မှု ဆိုသည်မှာ သော့ ပေါက်ကြားခြင်းဖြင့် ယခင်မှတ်စုများ ဖော်ထုတ်၍မရပါ။ QR ကုဒ်ဖြင့် စက်ပစ္စည်းအသစ်များကို လုံခြုံစွာ ချိတ်ဆက်ပါ။',
      link: 'လုံခြုံရေး မော်ဒယ်ကို ဖတ်ပါ',
    },
    deploy: {
      heading: 'အသုံးချရန် အဆင်သင့်ဖြစ်ပြီလား?',
      description: 'Llámenos ကို Docker မှတစ်ဆင့် ကိုယ်တိုင် hosting လုပ်သည် \u2014 အရာအားလုံးကို သင် ထိန်းချုပ်သည်။ တစ်နာရီအတွင်း ဟော့တ်လိုင်းကို စတင်လိုက်ပါ။',
      cta: 'စတင်ရန်',
      github: 'GitHub တွင် ကြည့်ပါ',
    },
  },
  quc: {
    hero: {
      badge: "Jaqatal ruxe'el \u00b7 Ewanemal chupam ronojel",
      title: "Jaloj kamisanik jikomal",
      titleAccent: "kech ri e rajawaxik",
      description: "Llámenos jun riqo'j ri kuya' jikomal kech ri e oyonela' xuquje' ri e to'onela'. Tz'ib'anik ewanemal, ruk'amik oyonik pa q'ijul xuquje' jun nuk'uj ri man retaman ta \u2014 rech ri taq ch'ab'al jikomal kik'oje' ewan.",
      cta: 'Titikirisaj',
      ctaSecondary: "Tasik'ij ri rub'eyal jikomal",
    },
    features: {
      heading: "B'anik rech jaloj kamisanik",
      subtitle: "Ronojel ri rajawaxik jun jaloj kamisanik \u2014 ruk'amik oyonik, ewan tz'ib'anik, runuk'ik q'ij xuquje' taq samajib'al \u2014 pa jun xaq jaqatal.",
      items: [
        { icon: '\u{1F512}', title: "Tz'ib'anik ewanemal chupam ronojel", description: "Ri taq tz'ib'anik ke'ewan ruk' jun ewan q'aqa'l \u2014 jujun tz'ib'anik kukoj jun laj mifteya'. Ri amifteya' ya'tal ruk' PIN xuquje' man kelaq ta el pa ri awokisaxel." },
        { icon: '\u{1F4DE}', title: "Oyonik junam", description: "Ri taq oyonik e petinaq ke'uxlan kech konojel ri e to'onela' pa q'ijul. Ri nab'eyal kutz'om ri oyonik kuriq." },
        { icon: '\u{1F30D}', title: "Nimalaj 12 taq ch'ab'al", description: "Jalwachinik chupam Ingles, Espa\u00f1ol, Chino, Tagalog, Vietnamita, \u00c1rabe, Franc\u00e9s, Criollo Haitiano, Coreano, Ruso, Hindi, xuquje' Portugu\u00e9s." },
        { icon: '\u{1F399}', title: 'AI transkripsiy\u00f3n', description: "Rutz'ib'axik oyonik ruk' Whisper ruk' ewanemal. Ri ajchakuy xuquje' ri to'onel kakikoj chi kib'il kib'." },
        { icon: '\u{1F6E1}', title: "Koyb'al rech spam", description: "CAPTCHA ruk' ch'ab'al, ruchapik jalan xuquje' cholaj rech man kekoq ta pa q'ijul. Ri ajchakuyab' kakijalwachij ri koyb'al man rajawaxik ta kakirik chik." },
        { icon: '\u{1F4F1}', title: 'PWA pa oyowal', description: "Kusamajij pa xaq achi'el okisaxel. Nkoq achi'el jun app. Push okem rech oyonik ri kepetik." },
      ],
    },
    security: {
      heading: "Qas kitzij chirij jikomal",
      description: "Qak'ut ta ne ri ewan, ri man ewan ta xuquje' ri kurilo' ri server. Man k'o ta itzel. Ri amifteya' ewan ruk' PIN xuquje' k'o xa xe pa ch'ob'oj are taq jaqatal. Ri ewan q'aqa'l rech jujun tz'ib'anik are chi ri rumisaxik jun mifteya' man kuk'ut ta ri tz'ib'anik ojer. Ketob'an ri k'ak'a taq okisaxel ruk' jikomal ruk' QR.",
      link: "Tasik'ij ri rub'eyal jikomal",
    },
    deploy: {
      heading: "Amade at rech nak'am?",
      description: "Llámenos nuk'un ruk' Docker \u2014 at nakanoj ronojel. Tatikirisaj jun jaloj kamisanik pa jun hora.",
      cta: 'Titikirisaj',
      github: "Tawila' pa GitHub",
    },
  },
  mix: {
    hero: {
      badge: "Nuu ndiso'o \u00b7 Ndiso'o ndihi",
      title: "Telefono ja na'an ta'vi",
      titleAccent: "nuu ña'a da'vi ja ka'nu",
      description: "Llámenos kuu programa nuu ndiso'o ja ndiso'o nuu ña'a ka'an nuu telefono ji ña'a xinñu'u. Tu'un ndiso'o, ndakuatu'un ka'an kibi kibi ji ña'a tu kukanu'un \u2014 nuu tu'un ja ka'nu ndiso'o koo.",
      cta: "Kixia'a",
      ctaSecondary: "Kastu'un ja'an kua'a",
    },
    features: {
      heading: "Ndiso'o nuu ta'vi",
      subtitle: "Ndihi ja ka'nu telefono ta'vi \u2014 ndakuatu'un ka'an, tu'un ndiso'o, ndiso'o tniuu ji taq samajib'al \u2014 ini programa nuu ndiso'o.",
      items: [
        { icon: '\u{1F512}', title: "Tu'un ndiso'o ndihi", description: "Tu'un ndiso'o ji iin iin tu'un \u2014 iin iin tu'un ndiso'o ji iin llave. Llave ndiso'o ji PIN ji ma kee ini qalabkaaga." },
        { icon: '\u{1F4DE}', title: "Ka'an ndihi", description: "Ka'an ja va'a ndihi ña'a xinñu'u ja ka tniuu. Ña'a ja ñu'u ka'an ñu'u ja ndaa." },
        { icon: '\u{1F30D}', title: "Nimalaj 12 tu'un savi", description: "Ndihi tu'un nuu Ingl\u00e9s, Espa\u00f1ol, Chino, Tagalog, Vietnamita, \u00c1rabe, Franc\u00e9s, Criollo Haitiano, Coreano, Ruso, Hindi ji Portugu\u00e9s." },
        { icon: '\u{1F399}', title: "AI tu'un ndiso'o", description: "Tu'un ndiso'o ka'an ji Whisper ji ndiso'o ndihi. Satojiyo ji ña'a xinñu'u ka ndiso'o maa maa." },
        { icon: '\u{1F6E1}', title: "Ndiso'o nuu spam", description: "CAPTCHA tu'un, ndiso'o ja ka'nu ji lista ja ma va'a kibi kibi. Satojiyo ndiso'o ndakua tniuu ma ka kixia'a." },
        { icon: '\u{1F4F1}', title: "PWA nuu telefono", description: "Ka tniuu nuu ndihi qalabka. Ka ndiso'o nda'a app. Push nuu ka'an ja va'a." },
      ],
    },
    security: {
      heading: "Ndaa nuu ja'an kua'a",
      description: "Ndiso'o ndaa nasa ndiso'o, nasa ma ndiso'o ji nasa ka ndanduku servidor. Ma ka ña'a tu kukanu'un. Llave ndiso'o ji PIN ji ka ini memoria nuu ja ndiso'o. Ndiso'o iin iin tu'un kuu ja ma ka ndanduku tu'un ja nda'a. Ndiso'o qalabka ja'a ji QR.",
      link: "Kastu'un ja'an kua'a",
    },
    deploy: {
      heading: "Ndiso'o nuu ndakua?",
      description: "Llámenos ndiso'o maa ji Docker \u2014 maa ndiso'o ndihi. Kixia'a telefono ta'vi ini iin hora.",
      cta: "Kixia'a",
      github: "Ndanduku nuu GitHub",
    },
  },
};
