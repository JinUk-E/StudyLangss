// Original practice material. A1/A2/B1 are learning guides, not exam certification.
const source = '별빛공방 자체 제작 영어 연습';
const rows = {
  A1: [
    ['apple','/ˈæpəl/','사과','I eat an apple after lunch.','나는 점심 후에 사과를 먹습니다.'],
    ['library','/ˈlaɪbreri/','도서관','The library is next to the school.','도서관은 학교 옆에 있습니다.'],
    ['breakfast','/ˈbrekfəst/','아침 식사','We have breakfast at seven.','우리는 일곱 시에 아침을 먹습니다.'],
    ['usually','/ˈjuːʒuəli/','보통, 대개','I usually walk to work.','나는 보통 걸어서 출근합니다.'],
    ['weather','/ˈweðər/','날씨','The weather is nice today.','오늘은 날씨가 좋습니다.'],
    ['between','/bɪˈtwiːn/','~ 사이에','The cafe is between the bank and the park.','카페는 은행과 공원 사이에 있습니다.'],
    ['hungry','/ˈhʌŋɡri/','배고픈','Are you hungry now?','지금 배가 고픈가요?'],
    ['borrow','/ˈbɑːroʊ/','빌리다','Can I borrow your pen?','당신의 펜을 빌려도 될까요?']
  ],
  A2: [
    ['appointment','/əˈpɔɪntmənt/','예약, 약속','I have a dentist appointment tomorrow.','나는 내일 치과 예약이 있습니다.'],
    ['crowded','/ˈkraʊdɪd/','붐비는','The bus was crowded this morning.','오늘 아침 버스는 붐볐습니다.'],
    ['receipt','/rɪˈsiːt/','영수증','Please keep your receipt.','영수증을 보관해 주세요.'],
    ['instead','/ɪnˈsted/','대신에','It was raining, so we stayed home instead.','비가 와서 우리는 대신 집에 머물렀습니다.'],
    ['carefully','/ˈkerfəli/','주의 깊게','Read the instructions carefully.','안내를 주의 깊게 읽으세요.'],
    ['suggest','/səˈdʒest/','제안하다','I suggest taking an earlier train.','나는 더 이른 기차를 타는 것을 제안합니다.'],
    ['already','/ɔːlˈredi/','이미','She has already finished her homework.','그녀는 이미 숙제를 마쳤습니다.'],
    ['comfortable','/ˈkʌmftəbəl/','편안한','These shoes are very comfortable.','이 신발은 아주 편안합니다.']
  ],
  B1: [
    ['deadline','/ˈdedlaɪn/','마감 기한','We need to finish the report before the deadline.','우리는 마감 기한 전에 보고서를 끝내야 합니다.'],
    ['although','/ɔːlˈðoʊ/','비록 ~이지만','I enjoyed the trip although it rained.','비가 왔지만 나는 여행을 즐겼습니다.'],
    ['reliable','/rɪˈlaɪəbəl/','신뢰할 수 있는','We need a reliable internet connection.','우리는 안정적인 인터넷 연결이 필요합니다.'],
    ['consider','/kənˈsɪdər/','고려하다','You should consider all the options.','당신은 모든 선택지를 고려해야 합니다.'],
    ['improve','/ɪmˈpruːv/','향상시키다','Regular practice can improve your confidence.','규칙적인 연습은 자신감을 높일 수 있습니다.'],
    ['purpose','/ˈpɜːrpəs/','목적','What is the purpose of this meeting?','이 회의의 목적은 무엇인가요?'],
    ['available','/əˈveɪləbəl/','이용 가능한','The new service will be available next month.','새 서비스는 다음 달에 이용할 수 있습니다.'],
    ['responsible','/rɪˈspɑːnsəbəl/','책임이 있는','She is responsible for training new staff.','그녀는 신입 직원 교육을 담당합니다.']
  ]
};
export const englishPractice = Object.entries(rows).flatMap(([level, entries]) => entries.map(([word, reading, meaning, example, translation], index) => ({
  id: `en-${level.toLowerCase()}-${String(index + 1).padStart(2, '0')}`, language: 'en', level, word, reading, meaning, example, translation, target: word, source
})));
const q = (level, area, id, prompt, choices, answerIndex, explanation, passage) => ({ id: `en-${level.toLowerCase()}-${id}`, level, area, prompt, choices, answerIndex, explanation, tags: ['영어', level, area], source, ...(passage ? { passage } : {}) });
export const englishQuestions = [
  q('A1','vocabulary','v01','Choose the word: I am ___. I want something to eat.',['tired','hungry','cold','late'],1,'무언가 먹고 싶으므로 hungry(배고픈)가 알맞습니다. tired는 피곤한, cold는 추운, late는 늦은이라는 뜻입니다.'),
  q('A1','vocabulary','v02','Where can you borrow books?',['A bank','A kitchen','A library','A station'],2,'책을 빌릴 수 있는 장소는 library(도서관)입니다. borrow는 빌리다라는 뜻입니다.'),
  q('A1','grammar','g01','Choose the correct sentence.',['She work here.','She working here.','She are working here.','She works here.'],3,'현재의 습관이나 사실을 말할 때 주어가 she이면 일반동사에 -s를 붙여 She works here.라고 합니다.'),
  q('A1','grammar','g02','I ___ a student.',['am','is','are','be'],0,'주어 I에 맞는 현재형 be동사는 am입니다. He/She에는 is, You/We/They에는 are를 씁니다.'),
  q('A1','reading','r01','When does Mina get up?',['At six','At seven','At eight','At nine'],1,'첫 문장에 Mina gets up at seven.이라고 되어 있으므로 일어나는 시간은 일곱 시입니다. 여덟 시는 집에서 나가는 시간입니다.','Mina gets up at seven. She eats breakfast with her family. She leaves home at eight.'),
  q('A1','reading','r02','Where is the cafe?',['Next to the school','Inside the bank','Between the bank and the park','Behind the station'],2,'between A and B는 A와 B 사이에라는 뜻입니다. 카페는 은행과 공원 사이에 있습니다.','There is a small cafe between the bank and the park. It opens at nine every morning.'),
  q('A1','listening','l01','What does the speaker want?',['Tea','Milk','Juice','Water'],3,'화자는 I would like some water라고 말합니다. 물을 원하며 tea는 필요하지 않다고 덧붙입니다.','I would like some water, please. I do not need any tea.'),
  q('A1','listening','l02','What time is the meeting?',['At three','At two','At four','At five'],0,'회의 시간은 three o’clock입니다. 교실 번호 two와 시간을 혼동하지 마세요.','Our meeting is at three o’clock. Please come to room two.'),
  q('A2','vocabulary','v01','What should you keep after paying at a shop?',['A passport','A receipt','A timetable','A map'],1,'물건을 산 뒤 결제 내역을 확인하거나 환불에 사용할 수 있는 것은 receipt(영수증)입니다.'),
  q('A2','vocabulary','v02','The train was ___. There were no empty seats.',['quiet','empty','crowded','expensive'],2,'빈자리가 없었다는 설명에 맞는 말은 crowded(붐비는)입니다. empty는 비어 있는이라는 뜻으로 문맥과 반대입니다.'),
  q('A2','grammar','g01','We ___ to the museum yesterday.',['go','going','goes','went'],3,'yesterday는 과거의 시간을 나타냅니다. go의 불규칙 과거형인 went를 사용합니다.'),
  q('A2','grammar','g02','This bag is ___ than that one.',['cheaper','cheapest','cheap','more cheap'],0,'두 대상을 than으로 비교하고 있으므로 비교급 cheaper를 씁니다. cheap처럼 짧은 형용사는 보통 -er를 붙입니다.'),
  q('A2','reading','r01','Why did Ben stay home?',['He lost his ticket.','It was raining.','He had to work.','The cafe was closed.'],1,'비가 오기 시작해서 계획을 바꾸었습니다. instead는 앞서 말한 계획 대신 다른 행동을 했다는 뜻입니다.','Ben planned to walk to the park, but it started raining. He stayed home instead and watched a film.'),
  q('A2','reading','r02','What does the notice ask customers to do?',['Pay before Friday','Bring a friend','Keep the receipt','Call the manager'],2,'안내에는 Please keep your receipt.라고 적혀 있습니다. 물건을 반품할 때 영수증이 필요합니다.','You can return unused items within seven days. Please keep your receipt and bring it with the item.'),
  q('A2','listening','l01','What has changed?',['The meeting room','The ticket price','The bus number','The appointment time'],3,'예약 시간이 열 시에서 열한 시로 변경됐습니다. 병원 장소는 그대로라고 말합니다.','Your appointment was at ten, but the dentist is busy. Can you come at eleven instead? The clinic is still in the same building.'),
  q('A2','listening','l02','How will they travel?',['By train','By car','By bus','By bicycle'],0,'화자는 기차가 더 빠르다며 기차를 타자고 제안합니다. 버스는 느리고 차는 사용할 수 없습니다.','The bus takes an hour, and we cannot use my car today. The train takes only twenty minutes. Let’s take the train.'),
  q('B1','vocabulary','v01','A reliable service is a service that you can ___.',['repair','trust','avoid','cancel'],1,'reliable은 신뢰할 수 있는, 믿을 만한이라는 뜻입니다. 따라서 trust와 의미가 연결됩니다.'),
  q('B1','vocabulary','v02','The report must be finished by Friday. Friday is the ___.',['purpose','schedule','deadline','result'],2,'일을 끝내야 하는 마지막 시점은 deadline(마감 기한)입니다. schedule은 일정 전체를 뜻할 수 있습니다.'),
  q('B1','grammar','g01','If it rains tomorrow, we ___ the event indoors.',['held','holding','would held','will hold'],3,'실제로 일어날 수 있는 미래 조건은 if절에 현재형, 주절에 will + 동사원형을 사용합니다.'),
  q('B1','grammar','g02','She has worked here ___ 2020.',['since','for','during','until'],0,'시작 시점인 2020년 앞에는 since를 씁니다. for는 for six years처럼 기간 앞에 사용합니다.'),
  q('B1','reading','r01','Why is the team testing the service first?',['To reduce the price','To find problems before launch','To hire more staff','To cancel the launch'],1,'사용자들이 공개 전에 문제를 찾도록 테스트하고 있습니다. launch는 서비스의 출시나 공개를 뜻합니다.','The team plans to launch a new service next month. Before the launch, a small group of users will test it and report any problems. The team will then improve the service.'),
  q('B1','reading','r02','What is the writer’s main advice?',['Only study before exams','Avoid speaking until you are fluent','Practice a little every day','Use only difficult books'],2,'매일 짧게라도 연습하는 것이 드물게 오래 공부하는 것보다 낫다고 설명합니다. 완벽해질 때까지 말하기를 미루라는 조언이 아닙니다.','You do not need to study for hours every day. Ten minutes of regular practice can be more useful than a long session once a month. Try speaking even when you make mistakes.'),
  q('B1','listening','l01','What does the speaker ask the team to do first?',['Cancel the project','Send the report','Train new staff','Check the new schedule'],3,'일부 마감 기한이 바뀌었기 때문에 일을 시작하기 전에 새 일정을 확인하라고 요청합니다.','Before you start working, please check the new schedule. Some deadlines have changed. We will discuss your questions at tomorrow’s meeting.'),
  q('B1','listening','l02','Why does the speaker recommend the earlier train?',['To allow time for delays','To buy cheaper food','To meet the driver','To avoid changing platforms'],0,'연결편을 놓치지 않도록 지연에 대비할 시간을 확보하자는 이유입니다. 표 값이나 승강장 변경은 언급하지 않습니다.','I suggest taking the earlier train. Although it means getting up sooner, we will have extra time if there are delays. I do not want to miss our connection.')
];
