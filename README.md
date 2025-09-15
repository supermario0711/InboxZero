# Gmail Personal Assistant 📧🤖

> Transform your chaotic Gmail inbox into an organized, actionable workspace—without giving third parties access to your emails.

## The Problem

**5,000+ unread emails.** Sound familiar? 

While achieving Inbox Zero is the dream, spending hours manually sorting emails isn't realistic. Third-party automation tools exist, but they require granting external services full access to your Gmail account—including the ability to read and send emails on your behalf.

## The Solution

A **privacy-first Gmail personal assistant** that runs entirely within Google's ecosystem using Apps Script and Gemini AI. Your emails never leave Google's servers, and only you maintain access.

## ✨ Features

### 🔍 **Intelligent Email Classification**
Automatically categorizes emails into actionable categories:

**Action Categories:**
- 🚨 **Urgent** - Requires immediate attention
- 📋 **To Do** - Needs response/action soon  
- ⏳ **Waiting** - Awaiting response from others
- 🔒 **Security Alert** - Account security notifications

**Reference Categories:**
- 💰 **Financials** - Bills, statements, financial updates
- 📰 **Creator Newsletters** - Content creator updates with summaries
- 👥 **Social & Community** - Social platform notifications, community updates
- 🛍️ **Purchases** - Order confirmations, shipping updates
- 🏷️ **Promotions** - Marketing emails, sales, offers
- 📂 **Misc** - Everything else

### 📊 **Smart Summary Reports**
Receive twice-daily email summaries that:
- **Aggregate** similar emails intelligently (e.g., all social notifications in one section)
- **Summarize** newsletter content individually with key insights
- **Highlight** urgent items requiring immediate attention
- **Include** direct links to original emails for quick access (only works on Desktop)

### 🗃️ **Automated Archiving Logic**
Category-specific archiving rules:

**Action Categories** (Never auto-archive):
- **Urgent**: Stay in inbox
- **To Do**: Stay in inbox  
- **Waiting**: Stay in inbox
- **Security Alert**: Stay in inbox

**Reference Categories**:
- **Financials**: Archive after 7 days (with 5-day notice)
- **Creator Newsletters**: Auto-archive immediately (after summary generation)
- **Social & Community**: Auto-archive immediately
- **Purchases**: Archive after 7 days (with 2-day notice)
- **Promotions**: Auto-archive immediately
- **Misc**: Keep in inbox

## 💰 Cost Estimate

**Very affordable!** Based on Gemini 2.0 Flash-Lite API pricing (2025):

### Daily Cost Calculation (50 emails/day)
- **Input tokens**: ~1,500 tokens per email × 50 emails = 75,000 tokens
- **Output tokens**: ~200 tokens per email × 50 emails = 10,000 tokens
- **Daily cost**: (75,000 × $0.10/1M) + (10,000 × $0.40/1M) = **~$0.012 per day**

### Monthly & Annual Costs
- **Monthly**: ~$0.36
- **Annual**: ~$4.40 (less than a coffee!)

**Note**: Actual costs may vary based on email length and complexity. The free tier includes generous quotas that may cover light usage entirely.

## 🔐 Privacy & Security

✅ **100% Google Ecosystem** - Uses only Apps Script and Gemini AI  
✅ **No Third-Party Access** - Your emails never leave Google's servers  
✅ **You Stay In Control** - Full access control remains with you  
✅ **No External APIs** - Everything runs within your Google account  

## 🚀 Getting Started

### Prerequisites
- Gmail account
- Google Apps Script access
- Gemini API access (free tier available)

### Installation

You can find a video instruction here: [https://youtu.be/MDlQQy4D60c](https://youtu.be/MDlQQy4D60c)

1. **Copy the code**
   - Copy the entire contents of `code.gs` from this repository

2. **Open Google Apps Script**
   - Go to [script.google.com](https://script.google.com)
   - Create a new project
   - Paste it into your Apps Script editor
   - Save the project

3. **Get Gemini API key**
   - Go to [Google AI Studio](https://aistudio.google.com)
   - Get your Gemini API key (free tier available)
   - Add the API key to your Apps Script project

4. **Set up triggers**
   - In Apps Script, go to "Triggers" (clock icon)
   - Add new trigger for `processEmailsDaily` function
   - Set to run "Time-driven" → "Day timer" → "6:00 to 7:00 AM"

5. **Pre-setup recommendation (Optional but Recommended)**
   - Archive emails older than 1 week to reduce processing load
   - This prevents the AI from categorizing thousands of old emails
   - Focus the system on recent, actionable content

6. **Test the setup**
   - Run the `processEmailsDaily` function manually first
   - Check your Gmail for the summary email
   - Verify emails are being categorized with labels

7. **Configure label colors (after running LIMITED or FULL mode)**
   - Go to Gmail → Settings → Labels in the left sidebar
   - Manually assign colors to the created labels for better visual organization
   - Suggested colors:
     - **Urgent**: Red
     - **Security Alert**: Red
     - **To Do**: Yellow
     - **Waiting**: Blue
     - **Social & Community**: Light Blue
     - **Purchases**: Light Orange
     - **Promotions**: Light Pink
     - **Financial**: Light Green
     - **Misc**: Light Gray
    
### Sample Output
![Sample Output](https://github.com/supermario0711/InboxZero/blob/main/InboxZero_Sample.png "InboxZero Sample Output")

### Configuration & Safety Modes

The script includes three safety modes for different use cases:

#### 🔍 **PREVIEW Mode** (Default)
- **Safe testing mode** - makes no changes to your mailbox
- Perfect for testing the AI classification without any risk
- Shows what would happen without actually doing it
- Set `MODE: 'PREVIEW'` in the configuration

#### 🎯 **LIMITED Mode** 
- **Controlled testing** - processes only the first 20 emails
- Applies actual changes but limits the scope
- Great for verifying everything works before full deployment
- Set `MODE: 'LIMITED'` in the configuration

#### ⚡ **FULL Mode**
- **Full automation** - processes all emails in your inbox
- Use only after testing with PREVIEW and LIMITED modes
- Recommended for daily automated runs
- Set `MODE: 'FULL'` in the configuration

#### Configuration Steps:
1. Open your `code.gs` file in Apps Script
2. Find the `CONFIG` section at the top
3. Add your Gemini API key to `GEMINI_API_KEY`
4. Start with `MODE: 'PREVIEW'` for safe testing
5. Gradually move to `LIMITED` then `FULL` as you gain confidence

## 📈 How It Works

1. **Scheduled Execution**: Apps Script triggers run automatically twice daily
2. **Email Retrieval**: Fetches unread emails from your inbox
3. **AI Classification**: Gemini analyzes each email's content and context
4. **Category Assignment**: Emails are tagged with appropriate categories
5. **Summary Generation**: Creates intelligent summaries grouped by category
6. **Archive Processing**: Applies category-specific archiving rules
7. **Report Delivery**: Sends summary email with actionable insights

## 🛠️ Customization

⚠️ **Important**: Since customizations require changes across multiple parts of the code (classification prompt, labels, archiving rules, summary formatting), we **strongly recommend using a code chatbot** like Claude, ChatGPT, or similar AI assistant for modifications.

### Why Use a Chatbot?
- **Complex interdependencies**: Adding a category requires updating:
  - The AI classification prompt
  - Label creation logic  
  - Archiving rules
  - Summary generation templates
- **Consistency**: AI ensures all related code sections stay synchronized
- **Error prevention**: Reduces risk of breaking the script with incomplete changes

### Common Customizations
Tell your AI assistant what you want to change:

**Adding Categories**: *"Add a 'Travel' category for flight confirmations and hotel bookings"*

**Modifying Archiving**: *"Archive financial emails after 30 days instead of keeping them"*  

**Summary Changes**: *"Make newsletter summaries shorter, only 1-2 sentences"*

**Label Adjustments**: *"Change label colors - make Urgent red and To Do orange"*

### DIY Customization
If you prefer manual editing, key sections to modify:
- Classification prompt (around line 200+)
- Label definitions and colors  
- Archiving logic in `processEmailsDaily()`
- HTML templates in summary generation

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines and submit pull requests for any improvements.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Google Apps Script team for the robust automation platform
- Gemini AI for intelligent email classification
- [Claude Code](https://claude.ai/code) for development assistance and code optimization

---

**Ready to reclaim your inbox?** ⭐ Star this repo if it helped organize your email chaos!
