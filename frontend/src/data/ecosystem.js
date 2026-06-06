// Waaie Ecosystem — the catalogue of sister AI platforms surfaced in the
// in-app hub (EcosystemBar → EcosystemHub). Pure data, no JSX: each entry's
// `icon` is a string key resolved to a glyph component inside EcosystemHub, so
// this module stays import-safe everywhere (tests/SSR) and trivial to extend.
//
// Shape:
//   key         stable identifier (also the React list key)
//   title       Arabic display name (short)
//   subtitle    Latin/brand name, rendered uppercase on cards
//   tagline     one-line pitch for the launcher card
//   icon        glyph key → ICONS map in EcosystemHub
//   description full Arabic description shown in the preview modal
//   features    4 highlighted capabilities (bulleted grid in the preview)
//   url         external destination (opened in a new tab)

export const ECOSYSTEM = [
  {
    key: 'cyberguard',
    title: 'سايبر غارد',
    subtitle: 'CyberGuard AI',
    tagline: 'حصّن نفسك رقمياً بمساعد أمني سيبراني يحاورك صوتاً.',
    icon: 'shield',
    description:
      'تجربة تفاعلية صوتية متكاملة تساعد المستخدمين على حماية أنفسهم رقمياً من خلال محادثة ذكية تشبه التحدث مع خبير أمني سيبراني.',
    features: [
      'مساعد أمني صوتي وكتابي للإجابة على استفسارات الأمن السيبراني فوراً',
      'فاحص الروابط الذكي لتحليل روابط التصيد الاحتيالي والمواقع الخبيثة قبل فتحها',
      'مكشاف التزييف العميق (Deepfake) لتحديد الأصوات البشرية الحقيقية من المستنسخة بالذكاء الاصطناعي',
      'سجل محادثات سحابي متكامل للرجوع إلى الاستشارات الأمنية السابقة في أي وقت',
    ],
    url: 'https://cybergaurdai.lovable.app/',
  },
  {
    key: 'bitbot',
    title: 'بت بوت 2.0',
    subtitle: 'BITBOT',
    tagline: 'أتقن البرمجة والمايكروبت بتعلّم تفاعلي ذكي يبدأ من الصفر.',
    icon: 'code',
    description:
      'موقع تعليمي ذكي مخصص لتطوير مهارات البرمجة والتقنية لدى الطلاب من خلال التعلم التفاعلي والاختبارات الذكية، يدمج بين لغات البرمجة المتنوعة وتعلم المايكروبت في منصة واحدة.',
    features: [
      'تقييم مستوى المستخدم برمجياً عبر اختبارات تفاعلية ذكية',
      'توليد محتوى تعليمي مخصص وديناميكي يناسب مستوى الطالب الحالي',
      'دمج تطبيقات المايكروبت (Micro:bit) والبرمجة الصورية والنصية بسلاسة',
      'رحلة تعليمية ممتعة ومنظمة ومصممة للبدء من الصفر بدون خبرة سابقة',
    ],
    url: 'https://bitbothelper.lovable.app',
  },
  {
    key: 'nibras',
    title: 'منصة نبراس',
    subtitle: 'Nibras Hub',
    tagline: 'تدرّب على القدرات والتحصيلي بمحاكاة واقعية ومساعد صوتي.',
    icon: 'compass',
    description:
      'منصة ذكية رائدة متخصصة في التدريب والاختبارات المحاكية لاختباري القدرات والتحصيلي الوطني، مدعومة بمساعد صوتي متطور لتعزيز الكفاءة التعليمية.',
    features: [
      'اختبارات محاكاة حقيقية لمعايير المركز الوطني للقياس',
      'مساعد صوتي تفاعلي متطور يشرح كواليس الأسئلة الصعبة للطلاب يدوياً وصوتياً',
      'تحليل ذكي لمستوى الطالب وتحديد مكامن الضعف والقوة لتوجيه المذاكرة',
      'بنك أسئلة متجدد يغطي كافة الأقسام الكمية واللفظية والعلمية',
    ],
    url: 'https://nibras-prep-hub.base44.app/',
  },
  {
    key: 'vision-guide',
    title: 'مرشد رؤية 2030',
    subtitle: 'Vision 2030 Guide',
    tagline: 'استكشف مشاريع رؤية المملكة 2030 بمحادثة ذكية ثنائية اللغة.',
    icon: 'landmark',
    description:
      'مساعدك الذكي الشخصي لاستكشاف وفهم مشاريع رؤية المملكة العربية السعودية 2030، يقدم معلومات سياحية وتاريخية واقتصادية دقيقة بأسلوب محادثاتي مبهر.',
    features: [
      'تغطية معرفية شاملة لكافة المشاريع الكبرى (نيوم، البحر الأحمر، القدية، وغيرها)',
      'دعم كامل وثنائي اللغة (العربية والإنجليزية) بطلاقة تامة',
      'تقديم سياقات تاريخية وجغرافية وسياحية دقيقة وسريعة للمهتمين والسياح',
      'واجهة محادثات ذكية مبسطة لاستخلاص الأرقام والمستهدفات الوطنية بسلاسة',
    ],
    url: 'https://vision-guide-saudi.base44.app/',
  },
  {
    key: 'qudra-assistant',
    title: 'مساعد القدرات العامّة',
    subtitle: 'General Aptitude',
    tagline: 'أتقن القدرات العامة بأسئلة مصنّفة وشرح صوتي فوري.',
    icon: 'target',
    description:
      'منصة تعليمية تفاعلية متخصصة في التدريب على اختبار القدرات العامة (قياس)، تجمع بين بنك أسئلة مصنف، استراتيجيات الحل السريع، ومساعد صوتي يحاور الطالب لحظياً.',
    features: [
      'بنك أسئلة مصنف يحتوي على 152 سؤالاً لفظياً موزعة على 5 أقسام رئيسية مع تصحيح فوري',
      'شرح ذكي مدعوم بنموذج Gemini يفكك طريقة الحل ويشرح استراتيجيات التفكير بأسلوب تشجيعي',
      'وكيل صوتي محادثاتي متطور من ElevenLabs يحاور الطالب صوتاً وكتابة',
      'أداة استدعاء ذكية لجلب أي سؤال بالرقم والقسم المخصص وشرحه صوتياً',
    ],
    url: 'https://qudra.onrender.com/',
  },
  {
    key: 'legal-advisor',
    title: 'المستشار القانوني الذكي',
    subtitle: 'AI Legal Advisor',
    tagline: 'مستشارك القضائي لصياغة المذكرات وتحليل الدفوع وتوقع الأحكام.',
    icon: 'scale',
    description:
      'نموذج ذكاء اصطناعي قضائي متقدم، تم تدريبه وحشوه بكافة الأنظمة واللوائح والدراسات القضائية، قادر على صياغة المذكرات وتحليل الدفوع وتوقع الأحكام.',
    features: [
      'تحليل ذكي ومعمق للقضايا القانونية المعقدة بناءً على المعطيات والأنظمة المرعية',
      'التنبؤ المستند إلى البيانات والأنظمة لنتائج الأحكام القضائية المتوقعة',
      'صياغة احترافية وفورية للمذكرات القانونية، صحائف الدعوى، واللوائح الاعتراضية',
      'تغطية معرفية شاملة لكافة مجالات القانون (تجاري، جنائي، أحوال شخصية، إداري)',
    ],
    url: 'https://high-rise--bassam070.replit.app',
  },
];

export default ECOSYSTEM;
