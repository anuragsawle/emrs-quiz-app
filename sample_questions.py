"""
Sample Questions and Initial Teams for EMRS Quiz Competition.
These provide an instant working competition dataset without manual entry.
"""

SAMPLE_TEAMS = [
    {"code": "T01", "name": "Team Birsa Munda", "members": "Aryan, Sunita, Rahul", "pin": "1001", "station": "PC-01"},
    {"code": "T02", "name": "Team Rani Gaidinliu", "members": "Pooja, Manoj, Anjali", "pin": "1002", "station": "PC-02"},
    {"code": "T03", "name": "Team Alluri Sitarama Raju", "members": "Kavita, Suresh, Rohit", "pin": "1003", "station": "PC-03"},
    {"code": "T04", "name": "Team Tilka Majhi", "members": "Deepak, Meena, Amit", "pin": "1004", "station": "PC-04"},
    {"code": "T05", "name": "Team Tantia Bhil", "members": "Vikram, Sneha, Ajay", "pin": "1005", "station": "PC-05"},
    {"code": "T06", "name": "Team Komaram Bheem", "members": "Sanjay, Priya, Neha", "pin": "1006", "station": "PC-06"},
    {"code": "T07", "name": "Team Sidhu-Kanhu", "members": "Gaurav, Divya, Rakesh", "pin": "1007", "station": "PC-07"},
    {"code": "T08", "name": "Team Khasi Warriors", "members": "Lalita, Mohan, Swati", "pin": "1008", "station": "PC-08"},
    {"code": "T09", "name": "Team Gondwana Braves", "members": "Kishore, Usha, Pankaj", "pin": "1009", "station": "PC-09"},
    {"code": "T10", "name": "Team Adivasi Pioneers", "members": "Bhavna, Ravi, Preeti", "pin": "1010", "station": "PC-10"},
    {"code": "T11", "name": "Team Santhal Strikers", "members": "Nitin, Rekha, Vinod", "pin": "1011", "station": "PC-11"},
    {"code": "T12", "name": "Team Bhil Explorers", "members": "Seema, Harish, Jyoti", "pin": "1012", "station": "PC-12"},
    {"code": "T13", "name": "Team Munda Challengers", "members": "Arjun, Sunita, Vikas", "pin": "1013", "station": "PC-13"},
    {"code": "T14", "name": "Team Oraon Knights", "members": "Anita, Rajesh, Geeta", "pin": "1014", "station": "PC-14"},
    {"code": "T15", "name": "Team Garo Titans", "members": "Karan, Poonam, Dinesh", "pin": "1015", "station": "PC-15"}
]

QUALIFIER_QUESTIONS = [
    {
        "text": "Birsa Munda, the revered tribal freedom fighter, led the famous 'Ulgulan' (Great Tumult) in which present-day Indian state?",
        "options": ["Jharkhand", "Odisha", "Madhya Pradesh", "Chhattisgarh"],
        "correct_index": 0,
        "category": "Tribal Heritage",
        "explanation": "Birsa Munda led the Ulgulan movement in the Chotanagpur region of modern Jharkhand in the late 19th century."
    },
    {
        "text": "What is the primary objective of establishing Eklavya Model Residential Schools (EMRS) across India?",
        "options": [
            "Quality education for Scheduled Tribe students in remote areas",
            "Vocational training for urban college graduates",
            "Adult literacy programs in municipal wards",
            "Specialized civil engineering coaching"
        ],
        "correct_index": 0,
        "category": "EMRS Awareness",
        "explanation": "EMRS aims to provide quality middle and high-level education to ST students in remote areas."
    },
    {
        "text": "Which gas is released during photosynthesis by green plants?",
        "options": ["Oxygen", "Carbon Dioxide", "Nitrogen", "Methane"],
        "correct_index": 0,
        "category": "Science",
        "explanation": "Plants absorb carbon dioxide and water, releasing oxygen as a byproduct of photosynthesis."
    },
    {
        "text": "If a triangle has interior angles of 50° and 60°, what is the measure of the third angle?",
        "options": ["70°", "80°", "90°", "60°"],
        "correct_index": 0,
        "category": "Mathematics",
        "explanation": "The sum of interior angles of a triangle is 180°. 180° - (50° + 60°) = 70°."
    },
    {
        "text": "Which Indian state is famous for the Warli folk painting tradition?",
        "options": ["Maharashtra", "Rajasthan", "Bihar", "Kerala"],
        "correct_index": 0,
        "category": "Art & Culture",
        "explanation": "Warli painting is a tribal art style created predominantly by the tribal people from the North Sahyadri Range in Maharashtra."
    },
    {
        "text": "What is the chemical formula for common table salt?",
        "options": ["NaCl", "KCl", "CaCO3", "NaHCO3"],
        "correct_index": 0,
        "category": "Science",
        "explanation": "Common salt is Sodium Chloride (NaCl)."
    },
    {
        "text": "Which planet in our solar system is known as the 'Red Planet'?",
        "options": ["Mars", "Venus", "Jupiter", "Saturn"],
        "correct_index": 0,
        "category": "Science",
        "explanation": "Mars appears reddish due to iron oxide (rust) on its surface."
    },
    {
        "text": "Who is known as the 'Father of the Indian Constitution'?",
        "options": ["Dr. B.R. Ambedkar", "Mahatma Gandhi", "Jawaharlal Nehru", "Sardar Vallabhbhai Patel"],
        "correct_index": 0,
        "category": "Social Science",
        "explanation": "Dr. Bhimrao Ramji Ambedkar served as the chairman of the Drafting Committee of the Constitution."
    },
    {
        "text": "What is the value of 15% of 400?",
        "options": ["60", "40", "50", "75"],
        "correct_index": 0,
        "category": "Mathematics",
        "explanation": "15/100 * 400 = 15 * 4 = 60."
    },
    {
        "text": "In which national park in India would you find the endangered Great One-Horned Rhinoceros?",
        "options": ["Kaziranga National Park", "Jim Corbett National Park", "Gir National Park", "Sundarbans National Park"],
        "correct_index": 0,
        "category": "Geography",
        "explanation": "Kaziranga National Park in Assam hosts two-thirds of the world's great one-horned rhinoceroses."
    },
    {
        "text": "Which unit is used to measure electrical resistance?",
        "options": ["Ohm", "Volt", "Ampere", "Watt"],
        "correct_index": 0,
        "category": "Science",
        "explanation": "Electrical resistance is measured in Ohms (symbol: Ω)."
    },
    {
        "text": "What is the capital city of the northeastern state of Nagaland?",
        "options": ["Kohima", "Dimapur", "Shillong", "Aizawl"],
        "correct_index": 0,
        "category": "Geography",
        "explanation": "Kohima is the capital city of Nagaland."
    },
    {
        "text": "Which organ in the human body produces the digestive fluid called bile?",
        "options": ["Liver", "Stomach", "Pancreas", "Kidney"],
        "correct_index": 0,
        "category": "Science",
        "explanation": "Bile is produced by the liver and stored in the gallbladder."
    },
    {
        "text": "What is the square root of 625?",
        "options": ["25", "15", "35", "45"],
        "correct_index": 0,
        "category": "Mathematics",
        "explanation": "25 * 25 = 625."
    },
    {
        "text": "The famous movement 'Chipko Andolan' in Uttarakhand was aimed at protecting what?",
        "options": ["Forests and Trees", "Tigers", "Rivers", "Agricultural Seeds"],
        "correct_index": 0,
        "category": "Environment",
        "explanation": "The Chipko movement began in 1973 where villagers hugged trees to prevent them from being felled."
    },
    {
        "text": "Which fundamental rights article in the Indian Constitution guarantees the 'Right to Equality'?",
        "options": ["Article 14 to 18", "Article 19 to 22", "Article 25 to 28", "Article 32"],
        "correct_index": 0,
        "category": "Social Science",
        "explanation": "Articles 14 through 18 of the Constitution provide for equality before the law and prohibit discrimination."
    },
    {
        "text": "What is the speed of light in a vacuum approximately?",
        "options": ["300,000 km/s", "150,000 km/s", "30,000 km/s", "1,000,000 km/s"],
        "correct_index": 0,
        "category": "Science",
        "explanation": "Light travels at approximately 299,792 kilometers per second in a vacuum."
    },
    {
        "text": "Which Indian festival celebrated in Kerala features the grand snake boat races (Vallam Kali)?",
        "options": ["Onam", "Pongal", "Bihu", "Vishu"],
        "correct_index": 0,
        "category": "Art & Culture",
        "explanation": "Snake boat races are a key feature of the Onam harvest festival in Kerala."
    },
    {
        "text": "Solve for x: 3x + 12 = 39",
        "options": ["9", "7", "11", "13"],
        "correct_index": 0,
        "category": "Mathematics",
        "explanation": "3x = 39 - 12 = 27 -> x = 27 / 3 = 9."
    },
    {
        "text": "Which river is known as the 'Sorrow of Bihar' due to its frequent devastating floods?",
        "options": ["Kosi River", "Gandak River", "Son River", "Ghaghara River"],
        "correct_index": 0,
        "category": "Geography",
        "explanation": "The Kosi River is referred to as the Sorrow of Bihar because of its shifting course and annual floods."
    }
]

FINAL_QUESTIONS = [
    {
        "text": "The tribal rebellion led by Rani Gaidinliu against British colonial rule took place primarily in which hills of Northeast India?",
        "options": ["Naga Hills", "Khasi Hills", "Mizo Hills", "Garo Hills"],
        "correct_index": 0,
        "category": "Tribal History & Freedom Struggle",
        "explanation": "Rani Gaidinliu was a Naga spiritual and political leader who led a revolt against British rule in India."
    },
    {
        "text": "Which Indian spacecraft successfully performed a soft landing near the south polar region of the Moon in August 2023?",
        "options": ["Chandrayaan-3", "Chandrayaan-2", "Mangalyaan", "Aditya-L1"],
        "correct_index": 0,
        "category": "Science & Space Technology",
        "explanation": "Chandrayaan-3 lander Vikram touched down successfully near the lunar south pole on 23 August 2023."
    },
    {
        "text": "The famous slogan 'Jal, Jangal, Zameen' (Water, Forest, Land) was coined by which legendary tribal leader?",
        "options": ["Komaram Bheem", "Tantia Bhil", "Tilka Majhi", "Govind Guru"],
        "correct_index": 0,
        "category": "Tribal Heritage",
        "explanation": "Komaram Bheem, a Gond tribal leader from Telangana, coined the historic slogan fighting the Nizam of Hyderabad."
    },
    {
        "text": "What is the primary structural component of plant cell walls?",
        "options": ["Cellulose", "Chitin", "Glycogen", "Keratin"],
        "correct_index": 0,
        "category": "Biology",
        "explanation": "Plant cell walls are primarily made of cellulose microfibrils embedded in a matrix."
    },
    {
        "text": "In mathematics, two integers are termed 'coprime' or 'relatively prime' if their Greatest Common Divisor (GCD) is:",
        "options": ["1", "0", "A prime number", "Equal to their sum"],
        "correct_index": 0,
        "category": "Mathematics",
        "explanation": "Two numbers are coprime if their only positive common divisor is 1."
    },
    {
        "text": "Which river forms the famous Dhuandhar Waterfalls near Jabalpur in Madhya Pradesh?",
        "options": ["Narmada", "Tapti", "Chambal", "Betwa"],
        "correct_index": 0,
        "category": "Geography",
        "explanation": "The Narmada River cuts through Marble Rocks forming the breathtaking Dhuandhar Falls."
    },
    {
        "text": "Alluri Sitarama Raju led the Rampa Rebellion of 1922-24 against the British Madras Forest Act in which region?",
        "options": ["Eastern Ghats (Andhra Pradesh)", "Western Ghats (Karnataka)", "Chota Nagpur Plateau", "Satpura Range"],
        "correct_index": 0,
        "category": "Freedom Movement",
        "explanation": "Alluri Sitarama Raju led tribal villagers in the Eastern Ghats of Godavari agency, Andhra Pradesh."
    },
    {
        "text": "Which atmospheric layer contains the ozone layer that absorbs harmful ultraviolet rays from the Sun?",
        "options": ["Stratosphere", "Troposphere", "Mesosphere", "Thermosphere"],
        "correct_index": 0,
        "category": "Earth Science",
        "explanation": "The ozone layer is primarily found in the lower portion of the stratosphere, around 15 to 35 km above Earth."
    },
    {
        "text": "If the radius of a circle is doubled, by what factor does its area increase?",
        "options": ["4 times", "2 times", "8 times", "16 times"],
        "correct_index": 0,
        "category": "Mathematics",
        "explanation": "Area = π * r^2. If r becomes 2r, new Area = π * (2r)^2 = 4 * π * r^2."
    },
    {
        "text": "The Dhokra metal casting technique, practiced by tribal artisans in Central India, uses which ancient casting method?",
        "options": ["Lost-wax casting", "Sand casting", "Die casting", "Centrifugal casting"],
        "correct_index": 0,
        "category": "Art & Crafts",
        "explanation": "Dhokra is non-ferrous metal casting using the lost-wax (cire perdue) technique, dating back 4,000 years to Harappan times."
    },
    {
        "text": "Which Indian state has the highest percentage of forest cover in terms of its total geographical area (among states)?",
        "options": ["Mizoram", "Arunachal Pradesh", "Madhya Pradesh", "Nagaland"],
        "correct_index": 0,
        "category": "Geography & Environment",
        "explanation": "Mizoram has approximately 84.5% of its total area under forest cover, the highest percentage among Indian states."
    },
    {
        "text": "What type of lens is used in spectacles to correct myopia (nearsightedness)?",
        "options": ["Concave lens", "Convex lens", "Bifocal lens", "Cylindrical lens"],
        "correct_index": 0,
        "category": "Physics",
        "explanation": "A concave (diverging) lens is used to diverge incoming light rays so that the image forms sharply on the retina."
    }
]

def load_sample_data(conn):
    """
    Disabled by admin policy:
    Never automatically inserts, modifies, or deletes questions or teams on server start.
    All questions and teams are managed exclusively and permanently by the admin.
    """
    pass
