(function () {
  "use strict";

  var DAY_MAP = {
    Mo: 1,
    Tu: 2,
    We: 3,
    Th: 4,
    Fr: 5,
    Sa: 6,
    Su: 0
  };

  var MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  function decodeHtml(value) {
    if (!value) {
      return "";
    }

    return value
      .replace(/&#(\d+);/g, function (_, code) {
        return String.fromCharCode(Number(code));
      })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, code) {
        return String.fromCharCode(parseInt(code, 16));
      })
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ");
  }

  function stripTags(value) {
    return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "));
  }

  function cleanText(value) {
    return stripTags(value)
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function foldIcsLine(line) {
    var output = "";
    var remaining = line;

    while (remaining.length > 75) {
      output += remaining.slice(0, 75) + "\r\n ";
      remaining = remaining.slice(75);
    }

    return output + remaining;
  }

  function escapeIcs(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n");
  }

  function hashString(value) {
    var hash = 0;
    var text = String(value || "");
    var index;

    for (index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(index);
      hash |= 0;
    }

    return Math.abs(hash).toString(36);
  }

  function parseSimHtml(source) {
    var raw = String(source || "");
    var scheduleHtml = extractScheduleDocument(raw);
    var termMatch = scheduleHtml.match(/DERIVED_REGFRM1_SSR_STDNTKEY_DESCR\$5\$[^>]*>([\s\S]*?)<\/span>/i);
    var term = cleanText(termMatch ? termMatch[1] : "");
    var courseBlocks = [];
    var blockPattern = /<div id=win2divSTDNT_ENRL_SSV2\$\d+>[\s\S]*?(?=<div id=win2divSTDNT_ENRL_SSV2\$\d+>|<div id=win2divSM_CUSTOM_WRK_GROUPBOX|<div id=win2divDERIVED_REGFRM1_SA_LINK_PRINTER|$)/gi;
    var match;

    while ((match = blockPattern.exec(scheduleHtml))) {
      courseBlocks.push(match[0]);
    }

    if (!courseBlocks.length) {
      throw new Error("Could not find any class blocks in the SIM HTML.");
    }

    var courses = courseBlocks.map(function (block, courseIndex) {
      return parseCourseBlock(block, courseIndex, term);
    }).filter(function (course) {
      return course.meetings.length > 0;
    });

    if (!courses.length) {
      throw new Error("Found the timetable page, but no class meetings were detected.");
    }

    var events = [];
    courses.forEach(function (course) {
      course.meetings.forEach(function (meeting) {
        events.push(meeting);
      });
    });

    return {
      term: term,
      courses: courses,
      events: events
    };
  }

  function parseSimText(source) {
    var normalized = normalizePlainText(source);
    var term = "";
    var courses = [];
    var currentCourse = null;
    var index = 0;

    while (index < normalized.length) {
      var line = normalized[index];

      if (!term && isTermLine(line)) {
        term = line;
        index += 1;
        continue;
      }

      if (isCourseTitle(line)) {
        currentCourse = {
          courseIndex: courses.length,
          title: line,
          courseCode: extractCourseCode(line),
          courseName: extractCourseName(line),
          status: "",
          units: "",
          meetings: []
        };
        courses.push(currentCourse);
        index += 1;
        continue;
      }

      if (!currentCourse) {
        index += 1;
        continue;
      }

      if (!currentCourse.status && isEnrollmentStatus(line)) {
        currentCourse.status = line;
        index += 1;
        continue;
      }

      if (!currentCourse.units && /^\d+\.\d{2}$/.test(line)) {
        currentCourse.units = line;
        index += 1;
        continue;
      }

      if (isMeetingHeader(line) || isNoiseLine(line)) {
        index += 1;
        continue;
      }

      var parsedMeeting = parsePlainTextMeeting(normalized, index, currentCourse, term);
      if (parsedMeeting) {
        currentCourse.meetings.push(parsedMeeting.meeting);
        index = parsedMeeting.nextIndex;
        continue;
      }

      index += 1;
    }

    courses = courses.filter(function (course) {
      return course.meetings.length > 0;
    });

    if (!courses.length) {
      throw new Error("Could not find any class meetings in the pasted timetable text.");
    }

    var events = [];
    courses.forEach(function (course) {
      course.meetings.forEach(function (meeting) {
        events.push(meeting);
      });
    });

    return {
      term: term,
      courses: courses,
      events: events
    };
  }

  function parseSimInput(source) {
    var text = String(source || "").trim();

    if (!text) {
      throw new Error("Please provide a SIM HTML file or copied timetable text first.");
    }

    if (/<html|<body|<iframe|<div|<table/i.test(text)) {
      return parseSimHtml(text);
    }

    return parseSimText(text);
  }

  function normalizePlainText(source) {
    return String(source || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(function (line) {
        return cleanText(line)
          .replace(/[\u200B-\u200D\uFEFF]/g, "")
          .replace(/\s*\|\s*/g, " | ");
      })
      .filter(Boolean)
      .filter(function (line) {
        return line !== "```" && line !== "````";
      });
  }

  function parsePlainTextMeeting(lines, startIndex, course, term) {
    var first = lines[startIndex];
    var second = lines[startIndex + 1];
    var third = lines[startIndex + 2];
    var fourth = lines[startIndex + 3];
    var fifth = lines[startIndex + 4];
    var sixth = lines[startIndex + 5];
    var seventh = lines[startIndex + 6];
    var carry = course._carry || {
      classNbr: "",
      section: "",
      component: "",
      instructor: "",
      meetingIndex: 0
    };
    var classNbr = carry.classNbr;
    var section = carry.section;
    var component = carry.component;
    var schedule = "";
    var location = "";
    var instructor = carry.instructor;
    var dates = "";
    var nextIndex = startIndex;

    if (isClassNumber(first) && isSection(second) && isComponent(third) && isScheduleLine(fourth) && isDateRange(seventh)) {
      classNbr = first;
      section = second;
      component = third;
      schedule = fourth;
      location = fifth || "";
      instructor = sixth;
      dates = seventh || "";
      nextIndex = startIndex + 7;
    } else if (isClassNumber(first) && isSection(second) && isComponent(third) && isScheduleLine(fourth) && isDateRange(seventh)) {
      classNbr = first;
      section = second;
      component = third;
      schedule = fourth;
      location = fifth || "";
      instructor = sixth || carry.instructor;
      dates = seventh;
      nextIndex = startIndex + 7;
    } else if (isScheduleLine(first) && isDateRange(fourth)) {
      schedule = first;
      location = second || "";
      instructor = third || carry.instructor;
      dates = fourth;
      nextIndex = startIndex + 4;
    } else if (isComponent(first) && isScheduleLine(second) && isDateRange(fifth)) {
      component = first;
      schedule = second;
      location = third || "";
      instructor = fourth || carry.instructor;
      dates = fifth;
      nextIndex = startIndex + 5;
    } else {
      return null;
    }

    if (!schedule || !dates) {
      return null;
    }

    carry.classNbr = classNbr;
    carry.section = section;
    carry.component = component;
    carry.instructor = instructor;
    carry.meetingIndex += 1;
    course._carry = carry;

    return {
      meeting: buildMeeting({
        term: term,
        courseIndex: course.courseIndex,
        meetingIndex: carry.meetingIndex,
        courseTitle: course.title,
        courseCode: course.courseCode,
        courseName: course.courseName,
        classNbr: classNbr,
        section: section,
        component: component,
        schedule: schedule,
        location: location,
        instructor: instructor,
        dates: dates,
        status: course.status,
        units: course.units
      }),
      nextIndex: nextIndex
    };
  }

  function isTermLine(line) {
    return /^\d{4} .+ \| .+ \| .+$/i.test(line);
  }

  function isCourseTitle(line) {
    return /^[A-Z]{2,}\s*\d+[A-Z]*\s*-\s*.+$/.test(line);
  }

  function extractCourseCode(line) {
    var match = line.match(/^([A-Z]{2,}\s*\d+[A-Z]*)\s*-/);
    return match ? match[1] : line;
  }

  function extractCourseName(line) {
    var match = line.match(/^[A-Z]{2,}\s*\d+[A-Z]*\s*-\s*(.+)$/);
    return match ? match[1] : line;
  }

  function isEnrollmentStatus(line) {
    return /^(Enrolled|Dropped|Wait Listed|Waitlisted)$/i.test(line);
  }

  function isMeetingHeader(line) {
    return line.indexOf("Class Nbr") !== -1 && line.indexOf("Days & Times") !== -1;
  }

  function isNoiseLine(line) {
    return [
      "GO!",
      "Personalised Timetable",
      "Select Display Option",
      "List View (Classes)",
      "List View (Exams)",
      "List View (Others)",
      "Weekly Calendar View",
      "Collapse section Class Schedule Filter Options Class Schedule Filter Options",
      "Class Schedule Filter Options",
      "Filter",
      "Show Enrolled Classes",
      "Show Dropped Classes",
      "Show Waitlisted Classes",
      "Collapse section Public Holidays Public Holidays",
      "Public Holidays",
      "Description Date",
      "Printer Friendly Page",
      "Search",
      "Plan",
      "Enroll",
      "My Academics",
      "personalised timetable",
      "add",
      "drop",
      "swap",
      "term information",
      "Personalised Timetable"
    ].indexOf(line) !== -1;
  }

  function isClassNumber(line) {
    return /^\d{3,}$/.test(line);
  }

  function isSection(line) {
    return /^[A-Z]\d{2,}[A-Z]*$/i.test(line);
  }

  function isComponent(line) {
    return /^(Lecture|Tutorial|Laboratory|Lab|Workshop|Seminar)$/i.test(line);
  }

  function isScheduleLine(line) {
    return /^[A-Za-z]{2}\s+\d{1,2}:\d{2}[AP]M\s*-\s*\d{1,2}:\d{2}[AP]M$/.test(line);
  }

  function isDateRange(line) {
    return /^\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}$/.test(line);
  }

  function extractScheduleDocument(source) {
    var srcdocMatch = source.match(/<iframe[^>]+id=ptifrmtgtframe[^>]+srcdoc=("|')([\s\S]*?)\1/i) ||
      source.match(/srcdoc=("|')([\s\S]*?)\1/i);

    if (srcdocMatch) {
      return decodeHtml(srcdocMatch[2]);
    }

    return source;
  }

  function parseCourseBlock(blockHtml, courseIndex, term) {
    var titleMatch = blockHtml.match(/class=PAGROUPDIVIDER[^>]*>([\s\S]*?)<\/tr>/i);
    var courseTitle = cleanText(titleMatch ? titleMatch[1] : "Course " + (courseIndex + 1));
    var courseCodeMatch = courseTitle.match(/^([A-Z]{2,}\s*\d+[A-Z]*)\s*-\s*(.+)$/i);
    var courseCode = courseCodeMatch ? cleanText(courseCodeMatch[1]) : courseTitle;
    var courseName = courseCodeMatch ? cleanText(courseCodeMatch[2]) : courseTitle;
    var statusMatch = blockHtml.match(/id=STATUS\$\d+[^>]*>([\s\S]*?)<\/span>/i);
    var unitsMatch = blockHtml.match(/id=DERIVED_REGFRM1_UNT_TAKEN\$\d+[^>]*>([\s\S]*?)<\/span>/i);
    var meetings = [];
    var rowPattern = /<tr id=trCLASS_MTG_VW\$\d+_row\d+[^>]*>[\s\S]*?<\/tr>/gi;
    var rowMatch;
    var carry = {
      classNbr: "",
      section: "",
      component: "",
      instructor: ""
    };
    var meetingIndex = 0;

    while ((rowMatch = rowPattern.exec(blockHtml))) {
      var rowHtml = rowMatch[0];
      var classNbr = firstNonBlank(extractSpanValue(rowHtml, "DERIVED_CLS_DTL_CLASS_NBR"), carry.classNbr);
      var section = firstNonBlank(extractAnchorValue(rowHtml, "MTG_SECTION"), carry.section);
      var component = firstNonBlank(extractSpanValue(rowHtml, "MTG_COMP"), carry.component);
      var schedule = cleanText(extractSpanValue(rowHtml, "MTG_SCHED"));
      var location = cleanText(extractSpanValue(rowHtml, "MTG_LOC"));
      var instructor = firstNonBlank(extractSpanValue(rowHtml, "DERIVED_CLS_DTL_SSR_INSTR_LONG"), carry.instructor);
      var dates = cleanText(extractSpanValue(rowHtml, "MTG_DATES"));

      if (!schedule || !dates) {
        continue;
      }

      carry.classNbr = classNbr;
      carry.section = section;
      carry.component = component;
      carry.instructor = instructor;
      meetingIndex += 1;

      meetings.push(buildMeeting({
        term: term,
        courseIndex: courseIndex,
        meetingIndex: meetingIndex,
        courseTitle: courseTitle,
        courseCode: courseCode,
        courseName: courseName,
        classNbr: classNbr,
        section: section,
        component: component,
        schedule: schedule,
        location: location,
        instructor: instructor,
        dates: dates,
        status: cleanText(statusMatch ? statusMatch[1] : ""),
        units: cleanText(unitsMatch ? unitsMatch[1] : "")
      }));
    }

    return {
      title: courseTitle,
      courseCode: courseCode,
      courseName: courseName,
      status: cleanText(statusMatch ? statusMatch[1] : ""),
      units: cleanText(unitsMatch ? unitsMatch[1] : ""),
      meetings: meetings
    };
  }

  function firstNonBlank(primary, fallback) {
    return primary && primary !== "" ? primary : (fallback || "");
  }

  function extractSpanValue(rowHtml, idPrefix) {
    var regex = new RegExp("id=" + idPrefix + "\\$\\d+[^>]*>([\\s\\S]*?)<\\/span>", "i");
    var match = rowHtml.match(regex);
    return cleanText(match ? match[1] : "");
  }

  function extractAnchorValue(rowHtml, idPrefix) {
    var regex = new RegExp("id=" + idPrefix + "\\$\\d+[^>]*>[\\s\\S]*?<a[^>]*>([\\s\\S]*?)<\\/a>", "i");
    var match = rowHtml.match(regex);
    return cleanText(match ? match[1] : "");
  }

  function buildMeeting(data) {
    var scheduleParts = parseScheduleText(data.schedule);
    var dateParts = parseDateRange(data.dates);
    var startStamp = buildIcsDateTime(dateParts.start, scheduleParts.start24);
    var endStamp = buildIcsDateTime(dateParts.end, scheduleParts.end24);
    var simKey = [
      slugify(data.term),
      slugify(data.courseCode),
      slugify(data.section),
      slugify(data.component),
      String(data.meetingIndex)
    ].join("-");

    return {
      summary: data.courseTitle,
      courseCode: data.courseCode,
      courseName: data.courseName,
      classNbr: data.classNbr,
      section: data.section,
      component: data.component,
      instructor: data.instructor,
      location: data.location,
      status: data.status,
      units: data.units,
      scheduleText: data.schedule,
      dateText: data.dates,
      weekday: scheduleParts.weekday,
      startTimeText: scheduleParts.start,
      endTimeText: scheduleParts.end,
      start24: scheduleParts.start24,
      end24: scheduleParts.end24,
      startDate: dateParts.start,
      endDate: dateParts.end,
      startStamp: startStamp,
      endStamp: endStamp,
      simKey: simKey,
      uid: simKey + "-" + hashString(data.courseTitle + data.location + data.dates) + "@sim-calendar-parse"
    };
  }

  function parseScheduleText(scheduleText) {
    var match = scheduleText.match(/^([A-Za-z]{2})\s+(\d{1,2}:\d{2}[AP]M)\s*-\s*(\d{1,2}:\d{2}[AP]M)$/);
    if (!match) {
      throw new Error("Unsupported schedule format: " + scheduleText);
    }

    return {
      weekdayCode: match[1],
      weekday: fullDayName(match[1]),
      start: match[2],
      end: match[3],
      start24: toTwentyFourHour(match[2]),
      end24: toTwentyFourHour(match[3])
    };
  }

  function fullDayName(dayCode) {
    var names = {
      Mo: "Monday",
      Tu: "Tuesday",
      We: "Wednesday",
      Th: "Thursday",
      Fr: "Friday",
      Sa: "Saturday",
      Su: "Sunday"
    };

    return names[dayCode] || dayCode;
  }

  function toTwentyFourHour(value) {
    var match = value.match(/^(\d{1,2}):(\d{2})(AM|PM)$/);
    var hours = Number(match[1]);
    var minutes = match[2];
    var meridiem = match[3];

    if (meridiem === "AM" && hours === 12) {
      hours = 0;
    } else if (meridiem === "PM" && hours !== 12) {
      hours += 12;
    }

    return String(hours).padStart(2, "0") + ":" + minutes;
  }

  function parseDateRange(value) {
    var match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) {
      throw new Error("Unsupported date range format: " + value);
    }

    return {
      start: {
        day: match[1],
        month: match[2],
        year: match[3]
      },
      end: {
        day: match[4],
        month: match[5],
        year: match[6]
      }
    };
  }

  function buildIcsDateTime(dateParts, time24) {
    var time = time24.replace(":", "") + "00";
    return dateParts.year + dateParts.month + dateParts.day + "T" + time;
  }

  function generateIcs(parsed) {
    return generateIcsFromEvents(parsed.events);
  }

  function generateIcsFromEvents(events) {
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SIM Calendar Parse//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:SIM Timetable",
      "X-WR-TIMEZONE:Asia/Singapore",
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Singapore",
      "X-LIC-LOCATION:Asia/Singapore",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:+0800",
      "TZOFFSETTO:+0800",
      "TZNAME:+08",
      "DTSTART:19700101T000000",
      "END:STANDARD",
      "END:VTIMEZONE"
    ];
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

    events.forEach(function (event) {
      var description = [
        event.summary,
        event.component ? ("Component: " + event.component) : "",
        event.instructor ? ("Instructor: " + event.instructor) : ""
      ].filter(Boolean).join("\n");

      lines.push("BEGIN:VEVENT");
      lines.push(foldIcsLine("UID:" + event.uid));
      lines.push("DTSTAMP:" + stamp);
      lines.push(foldIcsLine("SUMMARY:" + escapeIcs(event.summary)));
      lines.push(foldIcsLine("DESCRIPTION:" + escapeIcs(description)));
      lines.push(foldIcsLine("LOCATION:" + escapeIcs(event.location || "")));
      lines.push("DTSTART;TZID=Asia/Singapore:" + event.startStamp);
      lines.push("DTEND;TZID=Asia/Singapore:" + event.endStamp);
      lines.push(foldIcsLine("X-SIM-KEY:" + escapeIcs(event.simKey)));
      lines.push(foldIcsLine("X-SIM-COURSE:" + escapeIcs(event.courseCode || "")));
      lines.push(foldIcsLine("X-SIM-SECTION:" + escapeIcs(event.section || "")));
      lines.push(foldIcsLine("X-SIM-COMPONENT:" + escapeIcs(event.component || "")));
      lines.push(foldIcsLine("X-SIM-CLASS-NBR:" + escapeIcs(event.classNbr || "")));
      lines.push("END:VEVENT");
    });

    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  function unfoldIcs(icsText) {
    return String(icsText || "").replace(/\r?\n[ \t]/g, "");
  }

  function parseIcs(icsText) {
    var text = unfoldIcs(icsText);
    var lines = text.split(/\r?\n/);
    var events = [];
    var current = null;
    var calendarName = "ICS Schedule";

    lines.forEach(function (line) {
      if (!line) {
        return;
      }

      if (line === "BEGIN:VEVENT") {
        current = {};
        return;
      }

      if (line === "END:VEVENT") {
        if (current) {
          finalizeIcsEvent(current);
          events.push(current);
        }
        current = null;
        return;
      }

      var separator = line.indexOf(":");
      if (separator === -1) {
        return;
      }

      var rawKey = line.slice(0, separator);
      var value = line.slice(separator + 1);
      var keyParts = rawKey.split(";");
      var key = keyParts[0].toUpperCase();
      var params = {};

      keyParts.slice(1).forEach(function (part) {
        var paramSeparator = part.indexOf("=");
        if (paramSeparator !== -1) {
          params[part.slice(0, paramSeparator).toUpperCase()] = part.slice(paramSeparator + 1);
        }
      });

      if (current) {
        current[key] = { value: value, params: params };
      } else if (key === "X-WR-CALNAME") {
        calendarName = value;
      }
    });

    events.sort(function (left, right) {
      return compareComparable(left.sortKey, right.sortKey);
    });

    return {
      calendarName: calendarName,
      events: events
    };
  }

  function finalizeIcsEvent(event) {
    event.summary = getIcsValue(event, "SUMMARY");
    event.location = getIcsValue(event, "LOCATION");
    event.description = getIcsValue(event, "DESCRIPTION");
    event.uid = getIcsValue(event, "UID");
    event.simKey = getIcsValue(event, "X-SIM-KEY");
    event.courseCode = getIcsValue(event, "X-SIM-COURSE");
    event.section = getIcsValue(event, "X-SIM-SECTION");
    event.component = getIcsValue(event, "X-SIM-COMPONENT");
    event.classNbr = getIcsValue(event, "X-SIM-CLASS-NBR");
    event.instructor = extractDescriptionField(event.description, "Instructor");

    if (!event.component) {
      event.component = extractDescriptionField(event.description, "Component");
    }

    event.start = parseIcsDateValue(event.DTSTART);
    event.end = parseIcsDateValue(event.DTEND);
    event.sortKey = event.start ? (event.start.date + " " + event.start.time) : "9999-99-99 99:99";
    event.dateLabel = event.start ? event.start.prettyDate : "Unknown date";
    event.timeLabel = event.start && event.end ? (event.start.prettyTime + " - " + event.end.prettyTime) : "Unknown time";
  }

  function extractDescriptionField(description, label) {
    var regex = new RegExp("(?:^|\\n)" + label + ":\\s*(.+?)(?:\\n|$)", "i");
    var match = String(description || "").match(regex);
    return match ? match[1].trim() : "";
  }

  function getIcsValue(event, key) {
    if (!event[key]) {
      return "";
    }

    return event[key].value
      .replace(/\\n/g, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\");
  }

  function parseIcsDateValue(entry) {
    if (!entry || !entry.value) {
      return null;
    }

    var raw = entry.value;
    var match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/);
    if (!match) {
      return null;
    }

    var year = match[1];
    var month = match[2];
    var day = match[3];
    var hours = match[4] || "00";
    var minutes = match[5] || "00";
    var date = year + "-" + month + "-" + day;

    return {
      raw: raw,
      date: date,
      time: hours + ":" + minutes,
      prettyDate: formatIsoDate(date),
      prettyTime: formatTwentyFourHour(hours + ":" + minutes),
      tzid: entry.params && entry.params.TZID ? entry.params.TZID : (match[6] ? "UTC" : "floating")
    };
  }

  function formatIsoDate(date) {
    var parts = date.split("-");
    var jsDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return fullDayNameFromDate(jsDate) + ", " + Number(parts[2]) + " " + MONTHS[Number(parts[1]) - 1] + " " + parts[0];
  }

  function fullDayNameFromDate(jsDate) {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][jsDate.getDay()];
  }

  function formatTwentyFourHour(time) {
    var parts = time.split(":");
    var hours = Number(parts[0]);
    var minutes = parts[1];
    var suffix = hours >= 12 ? "PM" : "AM";
    var clock = hours % 12;
    if (clock === 0) {
      clock = 12;
    }
    return clock + ":" + minutes + suffix;
  }

  function compareComparable(left, right) {
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  }

  function compareIcs(beforeIcs, afterIcs) {
    var left = parseIcs(beforeIcs);
    var right = parseIcs(afterIcs);
    var leftGrouped = buildDiffMap(left.events);
    var rightGrouped = buildDiffMap(right.events);
    var allKeys = {};
    var changes = [];
    var added = [];
    var removed = [];
    var unchanged = [];

    Object.keys(leftGrouped).forEach(function (key) { allKeys[key] = true; });
    Object.keys(rightGrouped).forEach(function (key) { allKeys[key] = true; });

    Object.keys(allKeys).sort().forEach(function (key) {
      var leftEvents = leftGrouped[key] || [];
      var rightEvents = rightGrouped[key] || [];
      var pairCount = Math.max(leftEvents.length, rightEvents.length);
      var index;

      for (index = 0; index < pairCount; index += 1) {
        var beforeEvent = leftEvents[index] || null;
        var afterEvent = rightEvents[index] || null;

        if (beforeEvent && afterEvent) {
          var timeChanged = beforeEvent.start.raw !== afterEvent.start.raw || beforeEvent.end.raw !== afterEvent.end.raw;
          var locationChanged = normalizeCompare(beforeEvent.location) !== normalizeCompare(afterEvent.location);

          if (timeChanged || locationChanged) {
            changes.push({
              key: key,
              before: beforeEvent,
              after: afterEvent,
              timeChanged: timeChanged,
              locationChanged: locationChanged
            });
          } else {
            unchanged.push({
              key: key,
              before: beforeEvent,
              after: afterEvent
            });
          }
        } else if (beforeEvent) {
          removed.push(beforeEvent);
        } else if (afterEvent) {
          added.push(afterEvent);
        }
      }
    });

    return {
      leftName: left.calendarName,
      rightName: right.calendarName,
      leftEvents: left.events,
      rightEvents: right.events,
      changes: changes,
      unchanged: unchanged,
      added: added,
      removed: removed
    };
  }

  function normalizeCompare(value) {
    return String(value || "").trim().toLowerCase();
  }

  function buildDiffMap(events) {
    var grouped = {};

    events.forEach(function (event) {
      var key = buildEventCompareKey(event);

      if (!grouped[key]) {
        grouped[key] = [];
      }

      grouped[key].push(event);
    });

    Object.keys(grouped).forEach(function (key) {
      grouped[key].sort(function (left, right) {
        return compareComparable(left.sortKey, right.sortKey);
      });
    });

    return grouped;
  }

  function buildEventCompareKey(event) {
    if (event.simKey) {
      return "sim|" + normalizeCompare(event.simKey);
    }

    return [
      "logical",
      normalizeCompare(event.summary),
      normalizeCompare(event.courseCode),
      normalizeCompare(event.section),
      normalizeCompare(event.component),
      normalizeCompare(event.classNbr),
      normalizeCompare(event.instructor)
    ].join("|");
  }

  function renderSimSummary(parsed, icsText) {
    var html = [];
    html.push("<div class=\"stats-grid\">");
    html.push(renderStat("Term", parsed.term || "Unknown"));
    html.push(renderStat("Courses", String(parsed.courses.length)));
    html.push(renderStat("Events", String(parsed.events.length)));
    html.push(renderStat("Timezone", "Asia/Singapore"));
    html.push("</div>");

    html.push("<div class=\"course-list\">");
    parsed.courses.forEach(function (course) {
      html.push("<article class=\"course-card\">");
      html.push("<h3>" + escapeHtml(course.title) + "</h3>");
      html.push("<div class=\"pill-row\">");
      if (course.status) {
        html.push("<span class=\"pill\">" + escapeHtml(course.status) + "</span>");
      }
      if (course.units) {
        html.push("<span class=\"pill\">" + escapeHtml(course.units) + " units</span>");
      }
      html.push("<span class=\"pill\">" + course.meetings.length + " meeting" + (course.meetings.length === 1 ? "" : "s") + "</span>");
      html.push("</div>");
      html.push("<div class=\"meeting-list\">");
      course.meetings.forEach(function (meeting) {
        html.push("<div class=\"meeting-item\">");
        html.push("<div class=\"meeting-main\"><span>" + escapeHtml((meeting.weekday || "") + " - " + (meeting.timeLabelText || "")) + "</span><span>" + escapeHtml(meeting.component || meeting.section || "Class") + "</span></div>");
        html.push("<div class=\"meeting-sub\">" + escapeHtml(meeting.dateText + " | " + (meeting.location || "No location")) + "</div>");
        if (meeting.instructor) {
          html.push("<div class=\"meeting-sub\">Instructor: " + escapeHtml(meeting.instructor) + "</div>");
        }
        html.push("</div>");
      });
      html.push("</div>");
      html.push("</article>");
    });
    html.push("</div>");

    html.push("<div class=\"code-block\">" + escapeHtml(icsText) + "</div>");
    return html.join("");
  }

  function renderStat(label, value) {
    return "<div class=\"stat\"><span class=\"label\">" + escapeHtml(label) + "</span><span class=\"value\">" + escapeHtml(value) + "</span></div>";
  }

  function renderIcsViewer(parsed) {
    var grouped = {};
    var months = buildCalendarMonths(parsed.events);
    var html = [];

    parsed.events.forEach(function (event) {
      if (!grouped[event.dateLabel]) {
        grouped[event.dateLabel] = [];
      }
      grouped[event.dateLabel].push(event);
    });

    html.push("<div class=\"summary-grid\">");
    html.push(renderStat("Calendar", parsed.calendarName || "ICS Schedule"));
    html.push(renderStat("Events", String(parsed.events.length)));
    html.push(renderStat("Days", String(Object.keys(grouped).length)));
    html.push("</div>");
    html.push("<div class=\"calendar-stack\">");
    months.forEach(function (month) {
      html.push(renderCalendarMonth(month));
    });
    html.push("</div>");
    return html.join("");
  }

  function buildCalendarMonths(events) {
    var monthMap = {};

    events.forEach(function (event) {
      if (!event.start || !event.start.date) {
        return;
      }

      var parts = getDateParts(event.start.date);
      var monthKey = parts.year + "-" + parts.month;
      var dayKey = event.start.date;

      if (!monthMap[monthKey]) {
        monthMap[monthKey] = {
          key: monthKey,
          year: parts.year,
          month: parts.month,
          monthName: MONTHS[Number(parts.month) - 1],
          days: {}
        };
      }

      if (!monthMap[monthKey].days[dayKey]) {
        monthMap[monthKey].days[dayKey] = [];
      }

      monthMap[monthKey].days[dayKey].push(event);
    });

    return Object.keys(monthMap).sort().map(function (key) {
      return monthMap[key];
    });
  }

  function renderCalendarMonth(month) {
    var yearNumber = Number(month.year);
    var monthNumber = Number(month.month) - 1;
    var firstDay = new Date(yearNumber, monthNumber, 1);
    var daysInMonth = new Date(yearNumber, monthNumber + 1, 0).getDate();
    var startOffset = firstDay.getDay();
    var html = [];
    var weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var day;

    html.push("<section class=\"calendar-month\">");
    html.push("<div class=\"calendar-month-head\">");
    html.push("<h3>" + escapeHtml(month.monthName + " " + month.year) + "</h3>");
    html.push("<p>" + countMonthEvents(month) + " event" + (countMonthEvents(month) === 1 ? "" : "s") + "</p>");
    html.push("</div>");
    html.push("<div class=\"calendar-weekdays\">");
    weekdayLabels.forEach(function (label) {
      html.push("<span>" + label + "</span>");
    });
    html.push("</div>");
    html.push("<div class=\"calendar-grid\">");

    for (day = 0; day < startOffset; day += 1) {
      html.push("<div class=\"calendar-cell calendar-cell-empty\" aria-hidden=\"true\"></div>");
    }

    for (day = 1; day <= daysInMonth; day += 1) {
      html.push(renderCalendarDayCell(month, day));
    }

    html.push("</div>");
    html.push("</section>");
    return html.join("");
  }

  function renderCalendarDayCell(month, day) {
    var dayKey = month.year + "-" + month.month + "-" + String(day).padStart(2, "0");
    var events = (month.days[dayKey] || []).slice().sort(function (left, right) {
      return compareComparable(left.sortKey, right.sortKey);
    });
    var html = [];

    html.push("<article class=\"calendar-cell" + (events.length ? " has-events" : "") + "\">");
    html.push("<div class=\"calendar-day-number\">" + day + "</div>");

    if (events.length) {
      html.push("<div class=\"calendar-events\">");
      events.forEach(function (event) {
        html.push("<div class=\"calendar-event\">");
        html.push("<div class=\"calendar-event-time\">" + escapeHtml(event.timeLabel) + "</div>");
        html.push("<div class=\"calendar-event-title\">" + escapeHtml(event.summary || "Untitled event") + "</div>");
        if (event.location) {
          html.push("<div class=\"calendar-event-meta\">" + escapeHtml(event.location) + "</div>");
        }
        html.push("</div>");
      });
      html.push("</div>");
    }

    html.push("</article>");
    return html.join("");
  }

  function countMonthEvents(month) {
    return Object.keys(month.days).reduce(function (total, key) {
      return total + month.days[key].length;
    }, 0);
  }

  function getDateParts(date) {
    var parts = String(date).split("-");
    return {
      year: parts[0],
      month: parts[1],
      day: parts[2]
    };
  }

  function renderCompareSummary(result) {
    var html = [];

    if (!result.changes.length && !result.added.length && !result.removed.length) {
      html.push("<div class=\"compare-empty-state\">");
      html.push("<h3>No differences found</h3>");
      html.push("<p>The two calendars match. Equivalent events were merged automatically and nothing appears to have changed.</p>");
      html.push("</div>");
      return html.join("");
    }

    html.push("<div class=\"summary-grid\">");
    html.push(renderStat("Changed", String(result.changes.length)));
    html.push(renderStat("Merged Same", String(result.unchanged.length)));
    html.push(renderStat("Added", String(result.added.length)));
    html.push(renderStat("Removed", String(result.removed.length)));
    html.push("</div>");

    if (result.changes.length) {
      html.push(renderChangedCalendar(result));
      html.push("<div class=\"change-list\">");
      result.changes.forEach(function (change) {
        html.push("<article class=\"change-card\">");
        html.push("<h3>" + escapeHtml(change.after.summary || change.before.summary || "Changed class") + "</h3>");
        html.push("<div class=\"meta-row\">");
        if (change.timeChanged) {
          html.push("<span class=\"meta-pill\">Datetime changed</span>");
        }
        if (change.locationChanged) {
          html.push("<span class=\"meta-pill\">Location changed</span>");
        }
        html.push("</div>");
        html.push("<div class=\"change-detail\"><strong>Before:</strong> " + escapeHtml(change.before.dateLabel + " | " + change.before.timeLabel + " | " + (change.before.location || "No location")) + "</div>");
        html.push("<div class=\"change-detail\"><strong>After:</strong> " + escapeHtml(change.after.dateLabel + " | " + change.after.timeLabel + " | " + (change.after.location || "No location")) + "</div>");
        html.push("</article>");
      });
      html.push("</div>");
    }

    if (result.added.length || result.removed.length) {
      html.push("<div class=\"minor-list\">");
      result.added.forEach(function (event) {
        html.push("<article class=\"minor-card\"><div class=\"minor-detail success\"><strong>Added:</strong> " + escapeHtml(event.summary + " | " + event.dateLabel + " | " + event.timeLabel + " | " + (event.location || "No location")) + "</div></article>");
      });
      result.removed.forEach(function (event) {
        html.push("<article class=\"minor-card\"><div class=\"minor-detail danger\"><strong>Removed:</strong> " + escapeHtml(event.summary + " | " + event.dateLabel + " | " + event.timeLabel + " | " + (event.location || "No location")) + "</div></article>");
      });
      html.push("</div>");
    }

    return html.join("");
  }

  function renderChangedCalendar(result) {
    var months = buildChangedMonths(result);
    var html = [];

    html.push("<section class=\"compare-calendar-section\">");
    html.push("<div class=\"compare-calendar-head\">");
    html.push("<div><h3>Changed events calendar</h3><p>Plotted by the updated event date so you can scan the affected classes at a glance.</p></div>");
    html.push("<div class=\"compare-legend\"><span class=\"legend-pill\">New slot</span><span class=\"legend-pill legend-pill-before\">Previous slot</span></div>");
    html.push("</div>");
    html.push("<div class=\"calendar-stack compare-calendar-stack\">");
    months.forEach(function (month) {
      html.push(renderChangedCalendarMonth(month));
    });
    html.push("</div>");
    html.push("</section>");

    return html.join("");
  }

  function renderComparePanel(compareState, result) {
    var html = [];
    var months = buildComparePanelMonths(compareState, result);

    html.push("<section class=\"compare-calendar-section\">");
    html.push("<div class=\"compare-calendar-head\">");

    if (!compareState.first && !compareState.second) {
      html.push("<div><h3>Comparison calendar</h3><p>Upload ICS 1 or ICS 2 to start populating this calendar.</p></div>");
    } else if (compareState.first && !compareState.second) {
      html.push("<div><h3>ICS 1 preview</h3><p>The calendar shows events from the first file. Upload ICS 2 to compare against it.</p></div>");
    } else if (!compareState.first && compareState.second) {
      html.push("<div><h3>ICS 2 preview</h3><p>The calendar shows events from the second file. Upload ICS 1 to compare against it.</p></div>");
    } else {
      html.push("<div><h3>Comparison calendar</h3><p>Changed events are highlighted. Matching events stay visible with lower emphasis.</p></div>");
      html.push("<div class=\"compare-legend\"><span class=\"legend-pill\">Changed</span><span class=\"legend-pill legend-pill-before\">Same event</span></div>");
    }

    html.push("</div>");
    html.push("<div class=\"calendar-stack compare-calendar-stack\">");
    months.forEach(function (month) {
      html.push(renderComparePanelMonth(month));
    });
    html.push("</div>");
    html.push("</section>");

    return html.join("");
  }

  function buildComparePanelMonths(compareState, result) {
    var monthMap = {};
    var monthKeys = buildComparePanelMonthKeys(compareState, result);

    monthKeys.forEach(function (monthKey) {
      var parts = getDateParts(monthKey + "-01");
      monthMap[monthKey] = {
        key: monthKey,
        year: parts.year,
        month: parts.month,
        monthName: MONTHS[Number(parts.month) - 1],
        days: {}
      };
    });

    if (result) {
      result.unchanged.forEach(function (entry) {
        addComparePanelItem(monthMap, entry.after.start.date, {
          type: "same",
          event: entry.after
        });
      });

      result.changes.forEach(function (entry) {
        addComparePanelItem(monthMap, entry.after.start.date, {
          type: "changed",
          before: entry.before,
          after: entry.after
        });
      });
    } else {
      [compareState.first, compareState.second].forEach(function (slotState) {
        if (!slotState || !slotState.parsed) {
          return;
        }
        slotState.parsed.events.forEach(function (event) {
          addComparePanelItem(monthMap, event.start.date, {
            type: "preview",
            event: event
          });
        });
      });
    }

    return Object.keys(monthMap).sort().map(function (key) {
      return monthMap[key];
    });
  }

  function addComparePanelItem(monthMap, dateKey, item) {
    var parts = getDateParts(dateKey);
    var monthKey = parts.year + "-" + parts.month;

    if (!monthMap[monthKey]) {
      monthMap[monthKey] = {
        key: monthKey,
        year: parts.year,
        month: parts.month,
        monthName: MONTHS[Number(parts.month) - 1],
        days: {}
      };
    }

    if (!monthMap[monthKey].days[dateKey]) {
      monthMap[monthKey].days[dateKey] = [];
    }

    monthMap[monthKey].days[dateKey].push(item);
  }

  function buildComparePanelMonthKeys(compareState, result) {
    var dates = [];
    var today = new Date();
    var currentMonthKey = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0");
    var startMonth;
    var endMonth;

    if (result) {
      dates = collectCompareDates(result);
    } else {
      [compareState.first, compareState.second].forEach(function (slotState) {
        if (!slotState || !slotState.parsed) {
          return;
        }
        slotState.parsed.events.forEach(function (event) {
          if (event && event.start && event.start.date) {
            dates.push(event.start.date);
          }
        });
      });
    }

    if (!dates.length) {
      return [currentMonthKey];
    }

    dates.sort();
    startMonth = dates[0].slice(0, 7);
    endMonth = dates[dates.length - 1].slice(0, 7);

    if (currentMonthKey < startMonth) {
      startMonth = currentMonthKey;
    }
    if (currentMonthKey > endMonth) {
      endMonth = currentMonthKey;
    }

    return buildMonthRange(startMonth, endMonth);
  }

  function renderComparePanelMonth(month) {
    var yearNumber = Number(month.year);
    var monthNumber = Number(month.month) - 1;
    var firstDay = new Date(yearNumber, monthNumber, 1);
    var daysInMonth = new Date(yearNumber, monthNumber + 1, 0).getDate();
    var startOffset = firstDay.getDay();
    var weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var html = [];
    var day;

    html.push("<section class=\"calendar-month compare-month\">");
    html.push("<div class=\"calendar-month-head\">");
    html.push("<h3>" + escapeHtml(month.monthName + " " + month.year) + "</h3>");
    html.push("<p>" + countMonthEvents(month) + " visible event" + (countMonthEvents(month) === 1 ? "" : "s") + "</p>");
    html.push("</div>");
    html.push("<div class=\"calendar-weekdays\">");
    weekdayLabels.forEach(function (label) {
      html.push("<span>" + label + "</span>");
    });
    html.push("</div>");
    html.push("<div class=\"calendar-grid compare-calendar-grid\">");

    for (day = 0; day < startOffset; day += 1) {
      html.push("<div class=\"calendar-cell calendar-cell-empty\" aria-hidden=\"true\"></div>");
    }

    for (day = 1; day <= daysInMonth; day += 1) {
      html.push(renderComparePanelDayCell(month, day));
    }

    html.push("</div>");
    html.push("</section>");
    return html.join("");
  }

  function renderComparePanelDayCell(month, day) {
    var dayKey = month.year + "-" + month.month + "-" + String(day).padStart(2, "0");
    var items = (month.days[dayKey] || []).slice();
    var html = [];

    items.sort(function (left, right) {
      var leftKey = left.after ? left.after.sortKey : left.event.sortKey;
      var rightKey = right.after ? right.after.sortKey : right.event.sortKey;
      return compareComparable(leftKey, rightKey);
    });

    html.push("<article class=\"calendar-cell compare-calendar-cell" + (items.length ? " has-events" : "") + "\">");
    html.push("<div class=\"calendar-day-number\">" + day + "</div>");

    if (items.length) {
      html.push("<div class=\"calendar-events compare-events\">");
      items.forEach(function (item) {
        if (item.type === "changed") {
          html.push("<div class=\"calendar-event compare-event\">");
          html.push("<div class=\"calendar-event-title\">" + escapeHtml(item.after.summary || item.before.summary || "Changed class") + "</div>");
          html.push("<div class=\"compare-event-row\"><span class=\"compare-event-badge\">Now</span><span>" + escapeHtml(item.after.timeLabel + " | " + (item.after.location || "No location")) + "</span></div>");
          html.push("<div class=\"compare-event-row compare-event-row-before\"><span class=\"compare-event-badge compare-event-badge-before\">Was</span><span>" + escapeHtml(item.before.dateLabel + " | " + item.before.timeLabel + " | " + (item.before.location || "No location")) + "</span></div>");
          html.push("</div>");
        } else {
          html.push("<div class=\"calendar-event compare-preview-event" + (item.type === "same" ? " compare-preview-event-muted" : "") + "\">");
          html.push("<div class=\"calendar-event-time\">" + escapeHtml(item.event.timeLabel) + "</div>");
          html.push("<div class=\"calendar-event-title\">" + escapeHtml(item.event.summary || "Untitled event") + "</div>");
          if (item.event.location) {
            html.push("<div class=\"calendar-event-meta\">" + escapeHtml(item.event.location) + "</div>");
          }
          html.push("</div>");
        }
      });
      html.push("</div>");
    }

    html.push("</article>");
    return html.join("");
  }

  function buildChangedMonths(result) {
    var monthMap = {};
    var monthKeys = buildCompareMonthKeys(result);

    monthKeys.forEach(function (monthKey) {
      var parts = getDateParts(monthKey + "-01");
      monthMap[monthKey] = {
        key: monthKey,
        year: parts.year,
        month: parts.month,
        monthName: MONTHS[Number(parts.month) - 1],
        days: {}
      };
    });

    result.changes.forEach(function (change) {
      if (!change.after || !change.after.start || !change.after.start.date) {
        return;
      }

      var parts = getDateParts(change.after.start.date);
      var monthKey = parts.year + "-" + parts.month;
      var dayKey = change.after.start.date;

      if (!monthMap[monthKey]) {
        monthMap[monthKey] = {
          key: monthKey,
          year: parts.year,
          month: parts.month,
          monthName: MONTHS[Number(parts.month) - 1],
          days: {}
        };
      }

      if (!monthMap[monthKey].days[dayKey]) {
        monthMap[monthKey].days[dayKey] = [];
      }

      monthMap[monthKey].days[dayKey].push(change);
    });

    return Object.keys(monthMap).sort().map(function (key) {
      return monthMap[key];
    });
  }

  function buildCompareMonthKeys(result) {
    var dates = collectCompareDates(result);
    var today = new Date();
    var currentMonthKey = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0");
    var rangeStart;
    var rangeEnd;

    if (!dates.length) {
      return [currentMonthKey];
    }

    dates.sort();
    rangeStart = dates[0].slice(0, 7);
    rangeEnd = dates[dates.length - 1].slice(0, 7);

    if (currentMonthKey < rangeStart) {
      rangeStart = currentMonthKey;
    }
    if (currentMonthKey > rangeEnd) {
      rangeEnd = currentMonthKey;
    }

    return buildMonthRange(rangeStart, rangeEnd);
  }

  function collectCompareDates(result) {
    var dates = [];

    result.leftEvents.concat(result.rightEvents).forEach(function (event) {
      if (event && event.start && event.start.date) {
        dates.push(event.start.date);
      }
    });

    return dates;
  }

  function buildMonthRange(startMonthKey, endMonthKey) {
    var cursor = new Date(Number(startMonthKey.slice(0, 4)), Number(startMonthKey.slice(5, 7)) - 1, 1);
    var end = new Date(Number(endMonthKey.slice(0, 4)), Number(endMonthKey.slice(5, 7)) - 1, 1);
    var keys = [];

    while (cursor <= end) {
      keys.push(cursor.getFullYear() + "-" + String(cursor.getMonth() + 1).padStart(2, "0"));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    return keys;
  }

  function renderChangedCalendarMonth(month) {
    var yearNumber = Number(month.year);
    var monthNumber = Number(month.month) - 1;
    var firstDay = new Date(yearNumber, monthNumber, 1);
    var daysInMonth = new Date(yearNumber, monthNumber + 1, 0).getDate();
    var startOffset = firstDay.getDay();
    var weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var html = [];
    var day;

    html.push("<section class=\"calendar-month compare-month\">");
    html.push("<div class=\"calendar-month-head\">");
    html.push("<h3>" + escapeHtml(month.monthName + " " + month.year) + "</h3>");
    html.push("<p>" + countMonthEvents(month) + " changed event" + (countMonthEvents(month) === 1 ? "" : "s") + "</p>");
    html.push("</div>");
    html.push("<div class=\"calendar-weekdays\">");
    weekdayLabels.forEach(function (label) {
      html.push("<span>" + label + "</span>");
    });
    html.push("</div>");
    html.push("<div class=\"calendar-grid compare-calendar-grid\">");

    for (day = 0; day < startOffset; day += 1) {
      html.push("<div class=\"calendar-cell calendar-cell-empty\" aria-hidden=\"true\"></div>");
    }

    for (day = 1; day <= daysInMonth; day += 1) {
      html.push(renderChangedDayCell(month, day));
    }

    html.push("</div>");
    html.push("</section>");
    return html.join("");
  }

  function renderChangedDayCell(month, day) {
    var dayKey = month.year + "-" + month.month + "-" + String(day).padStart(2, "0");
    var changes = (month.days[dayKey] || []).slice().sort(function (left, right) {
      return compareComparable(left.after.sortKey, right.after.sortKey);
    });
    var html = [];

    html.push("<article class=\"calendar-cell compare-calendar-cell" + (changes.length ? " has-events" : "") + "\">");
    html.push("<div class=\"calendar-day-number\">" + day + "</div>");

    if (changes.length) {
      html.push("<div class=\"calendar-events compare-events\">");
      changes.forEach(function (change) {
        html.push("<div class=\"calendar-event compare-event\">");
        html.push("<div class=\"calendar-event-title\">" + escapeHtml(change.after.summary || change.before.summary || "Changed class") + "</div>");
        html.push("<div class=\"compare-event-row\"><span class=\"compare-event-badge\">Now</span><span>" + escapeHtml(change.after.timeLabel + " | " + (change.after.location || "No location")) + "</span></div>");
        html.push("<div class=\"compare-event-row compare-event-row-before\"><span class=\"compare-event-badge compare-event-badge-before\">Was</span><span>" + escapeHtml(change.before.dateLabel + " | " + change.before.timeLabel + " | " + (change.before.location || "No location")) + "</span></div>");
        html.push("</div>");
      });
      html.push("</div>");
    }

    html.push("</article>");
    return html.join("");
  }

  function enrichMeetingLabels(parsed) {
    parsed.events.forEach(function (event) {
      event.timeLabelText = formatTwentyFourHour(event.start24) + " - " + formatTwentyFourHour(event.end24);
    });
    parsed.courses.forEach(function (course) {
      course.meetings.forEach(function (meeting) {
        meeting.timeLabelText = formatTwentyFourHour(meeting.start24) + " - " + formatTwentyFourHour(meeting.end24);
      });
    });
    return parsed;
  }

  function bindUi() {
    if (typeof document === "undefined") {
      return;
    }

    var state = {
      currentView: "home",
      generatedIcs: "",
      generatedName: "sim-timetable.ics"
    };

    var views = Array.prototype.slice.call(document.querySelectorAll("[data-view]"));
    var convertStatus = document.getElementById("convert-status");
    var convertOutput = document.getElementById("convert-output");
    var sourceInput = document.getElementById("sim-source-input");
    var simFileInput = document.getElementById("sim-file-input");
    var downloadButton = document.getElementById("download-ics-button");
    var convertClearButton = document.getElementById("convert-clear-button");
    var convertResetButton = document.getElementById("convert-reset-button");
    var viewerStatus = document.getElementById("viewer-status");
    var viewerOutput = document.getElementById("viewer-output");
    var viewerFileInput = document.getElementById("viewer-file-input");
    var viewerClearButton = document.getElementById("viewer-clear-button");
    var viewerResetButton = document.getElementById("viewer-reset-button");
    var compareStatus = document.getElementById("compare-status");
    var compareOutput = document.getElementById("compare-output");
    var compareMeta = document.getElementById("compare-meta");
    var compareFileInput1 = document.getElementById("compare-file-input-1");
    var compareFileInput2 = document.getElementById("compare-file-input-2");
    var compareFileNote1 = document.getElementById("compare-file-note-1");
    var compareFileNote2 = document.getElementById("compare-file-note-2");
    var compareOrderWarning = document.getElementById("compare-order-warning");
    var compareOrderWarningText = document.getElementById("compare-order-warning-text");
    var compareSwapButton = document.getElementById("compare-swap-button");
    var compareDownloadButton = document.getElementById("compare-download-button");
    var compareClearButton = document.getElementById("compare-clear-button");
    var compareResetButton = document.getElementById("compare-reset-button");
    var convertTextTimer = null;
    var compareState = {
      first: null,
      second: null,
      diffIcs: "",
      diffName: "sim-calendar-diff.ics"
    };

    Array.prototype.slice.call(document.querySelectorAll("[data-open-view]")).forEach(function (button) {
      button.addEventListener("click", function () {
        setView(button.getAttribute("data-open-view"));
      });
    });

    bindCursorGlow();

    window.addEventListener("hashchange", function () {
      syncViewFromHash();
    });

    sourceInput.addEventListener("input", function () {
      clearTimeout(convertTextTimer);

      if (!sourceInput.value.trim()) {
        resetConvertTool(false);
        return;
      }

      convertClearButton.disabled = false;

      setStatus(convertStatus, "Parsing pasted timetable text...", false);
      convertTextTimer = window.setTimeout(function () {
        handleSimPastedText(sourceInput.value);
      }, 250);
    });

    simFileInput.addEventListener("change", function (event) {
      readSingleFile(event.target.files[0], handleSimText, function (message) {
        setStatus(convertStatus, message, true);
      });
    });

    viewerFileInput.addEventListener("change", function (event) {
      readSingleFile(event.target.files[0], handleViewerText, function (message) {
        setStatus(viewerStatus, message, true);
      });
    });

    compareFileInput1.addEventListener("change", function (event) {
      handleCompareSlotFile("first", event.target.files[0], "ICS 1");
    });

    compareFileInput2.addEventListener("change", function (event) {
      handleCompareSlotFile("second", event.target.files[0], "ICS 2");
    });

    downloadButton.addEventListener("click", function () {
      if (!state.generatedIcs) {
        return;
      }

      downloadText(state.generatedName, state.generatedIcs, "text/calendar;charset=utf-8");
    });

    convertResetButton.addEventListener("click", function () {
      resetConvertTool(true);
    });
    convertClearButton.addEventListener("click", function () {
      resetConvertTool(false);
    });
    viewerResetButton.addEventListener("click", function () {
      resetViewerTool(true);
    });
    viewerClearButton.addEventListener("click", function () {
      resetViewerTool(false);
    });
    compareResetButton.addEventListener("click", function () {
      resetCompareTool(true);
    });
    compareClearButton.addEventListener("click", function () {
      resetCompareTool(false);
    });
    compareDownloadButton.addEventListener("click", function () {
      if (!compareState.diffIcs) {
        return;
      }

      downloadText(compareState.diffName, compareState.diffIcs, "text/calendar;charset=utf-8");
    });
    compareSwapButton.addEventListener("click", function () {
      swapCompareFiles();
    });

    setupDropzone("sim-dropzone", function (files) {
      if (!files.length) {
        return;
      }
      setView("convert");
      readSingleFile(files[0], handleSimText, function (message) {
        setStatus(convertStatus, message, true);
      });
    });

    setupDropzone("viewer-dropzone", function (files) {
      if (!files.length) {
        return;
      }
      setView("viewer");
      readSingleFile(files[0], handleViewerText, function (message) {
        setStatus(viewerStatus, message, true);
      });
    });

    setupDropzone("compare-dropzone-1", function (files) {
      setView("compare");
      handleCompareSlotFile("first", files[0], "ICS 1");
    });

    setupDropzone("compare-dropzone-2", function (files) {
      setView("compare");
      handleCompareSlotFile("second", files[0], "ICS 2");
    });

    syncViewFromHash();

    function setView(nextView) {
      state.currentView = nextView;
      views.forEach(function (viewNode) {
        viewNode.classList.toggle("is-active", viewNode.getAttribute("data-view") === nextView);
      });
      if (typeof window !== "undefined" && window.location) {
        window.location.hash = nextView === "home" ? "" : nextView;
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function syncViewFromHash() {
      var hash = (window.location.hash || "").replace(/^#/, "");
      var nextView = hash || "home";
      var exists = views.some(function (viewNode) {
        return viewNode.getAttribute("data-view") === nextView;
      });

      setView(exists ? nextView : "home");
    }

    function bindCursorGlow() {
      var glowTargets = Array.prototype.slice.call(document.querySelectorAll(".hero-panel, .tool-header, .info-card, .workspace-card, .result-panel, .calendar-month, .course-card, .change-card, .minor-card, .meeting-item, .event-item, .compare-warning, .compare-empty-state, .stat, .tool-card, .dropzone, .launch-button, .primary-button, .secondary-button, .ghost-button, .back-link"));

      glowTargets.forEach(function (node) {
        node.addEventListener("pointermove", function (event) {
          var rect = node.getBoundingClientRect();
          node.style.setProperty("--mx", (event.clientX - rect.left) + "px");
          node.style.setProperty("--my", (event.clientY - rect.top) + "px");
        });
      });
    }

    function handleSimText(text) {
      try {
        var parsed = enrichMeetingLabels(parseSimInput(text));
        var icsText = generateIcs(parsed);
        state.generatedIcs = icsText;
        state.generatedName = "sim-timetable-" + slugify(parsed.term || "schedule") + ".ics";
        convertOutput.innerHTML = renderSimSummary(parsed, icsText);
        convertOutput.classList.remove("hidden");
        downloadButton.disabled = false;
        convertClearButton.disabled = false;
        setView("convert");
        setStatus(convertStatus, "Auto-parsed and converted " + parsed.events.length + " event" + (parsed.events.length === 1 ? "" : "s") + ".", false);
      } catch (error) {
        state.generatedIcs = "";
        state.generatedName = "sim-timetable.ics";
        downloadButton.disabled = true;
        convertClearButton.disabled = !sourceInput.value.trim() && !simFileInput.value;
        convertOutput.classList.add("hidden");
        convertOutput.innerHTML = "";
        setStatus(convertStatus, error.message, true);
      }
    }

    function handleSimPastedText(text) {
      try {
        var parsed = enrichMeetingLabels(parseSimText(text));
        var icsText = generateIcs(parsed);
        state.generatedIcs = icsText;
        state.generatedName = "sim-timetable-" + slugify(parsed.term || "schedule") + ".ics";
        convertOutput.innerHTML = renderSimSummary(parsed, icsText);
        convertOutput.classList.remove("hidden");
        downloadButton.disabled = false;
        convertClearButton.disabled = false;
        setView("convert");
        setStatus(convertStatus, "Converted copied timetable text into " + parsed.events.length + " event" + (parsed.events.length === 1 ? "" : "s") + ".", false);
      } catch (error) {
        state.generatedIcs = "";
        state.generatedName = "sim-timetable.ics";
        downloadButton.disabled = true;
        convertClearButton.disabled = !sourceInput.value.trim() && !simFileInput.value;
        convertOutput.classList.add("hidden");
        convertOutput.innerHTML = "";
        setStatus(convertStatus, error.message, true);
      }
    }

    function handleViewerText(text) {
      try {
        var parsed = parseIcs(text);
        viewerOutput.innerHTML = renderIcsViewer(parsed);
        viewerOutput.classList.remove("hidden");
        viewerClearButton.disabled = false;
        setView("viewer");
        setStatus(viewerStatus, "Loaded " + parsed.events.length + " event" + (parsed.events.length === 1 ? "" : "s") + ".", false);
      } catch (error) {
        viewerOutput.classList.add("hidden");
        viewerOutput.innerHTML = "";
        viewerClearButton.disabled = !viewerFileInput.value;
        setStatus(viewerStatus, error.message || "Could not parse the ICS file.", true);
      }
    }

    function handleCompareSlotFile(slot, file, slotLabel) {
      if (!file) {
        setStatus(compareStatus, slotLabel + " was not provided.", true);
        return;
      }

      readFileAsText(file).then(function (content) {
        var parsed = parseIcs(content);
        compareState[slot] = {
          name: file.name,
          content: content,
          parsed: parsed,
          eventCount: parsed.events.length,
          lastModified: file.lastModified || 0
        };
        updateCompareFileNote(slot);
        updateCompareOrderWarning();
        compareClearButton.disabled = false;
        setView("compare");
        updateCompareMeta();
        if (compareState.first && compareState.second) {
          handleCompareFiles(compareState.first, compareState.second);
        } else {
          compareState.diffIcs = "";
          compareState.diffName = "sim-calendar-diff.ics";
          compareDownloadButton.disabled = true;
          compareClearButton.disabled = false;
          compareOutput.innerHTML = renderComparePanel(compareState, null);
          setStatus(compareStatus, slotLabel + " loaded.", false);
        }
      }).catch(function (error) {
        setStatus(compareStatus, error.message || ("Could not read " + slotLabel + "."), true);
      });
    }

    function updateCompareMeta() {
      compareMeta.innerHTML = "";
    }

    function updateCompareOrderWarning() {
      if (!compareState.first || !compareState.second) {
        compareOrderWarning.classList.add("hidden");
        compareOrderWarningText.textContent = "";
        return;
      }

      if (compareState.first.lastModified && compareState.second.lastModified && compareState.first.lastModified > compareState.second.lastModified) {
        compareOrderWarning.classList.remove("hidden");
        compareOrderWarningText.textContent = "The file timestamp suggests ICS 1 may be newer than ICS 2, so the files might be in the wrong order. Click the button below to swap it quickly.";
      } else {
        compareOrderWarning.classList.add("hidden");
        compareOrderWarningText.textContent = "";
      }
    }

    function updateCompareFileNote(slot) {
      var stateForSlot = compareState[slot];
      var noteNode = slot === "first" ? compareFileNote1 : compareFileNote2;
      var label = slot === "first" ? "ICS 1" : "ICS 2";

      if (!stateForSlot) {
        noteNode.textContent = "No file loaded yet.";
        return;
      }

      noteNode.textContent = label + " loaded: " + stateForSlot.eventCount + " event" + (stateForSlot.eventCount === 1 ? "" : "s") + ".";
    }

    function handleCompareFiles(firstFile, secondFile) {
      if (!firstFile || !secondFile) {
        compareOutput.innerHTML = renderComparePanel(compareState, null);
        setStatus(compareStatus, "Please provide both ICS 1 and ICS 2.", true);
        return;
      }

      Promise.resolve().then(function () {
        var result = compareIcs(firstFile.content, secondFile.content);
        var exportEvents = result.changes.map(function (entry) {
          return entry.after;
        }).concat(result.added);

        compareState.diffIcs = exportEvents.length ? generateIcsFromEvents(exportEvents) : "";
        compareState.diffName = "sim-calendar-new-changed.ics";
        compareDownloadButton.disabled = exportEvents.length === 0;
        compareClearButton.disabled = false;
        updateCompareMeta();
        compareOutput.innerHTML = renderComparePanel(compareState, result);
        updateCompareOrderWarning();
        setView("compare");
        setStatus(compareStatus, result.changes.length || result.added.length || result.removed.length ? "Differences found." : "No differences found.", false);
      }).catch(function (error) {
        compareState.diffIcs = "";
        compareState.diffName = "sim-calendar-diff.ics";
        compareDownloadButton.disabled = true;
        compareClearButton.disabled = !(compareState.first || compareState.second);
        compareOutput.innerHTML = renderComparePanel(compareState, null);
        setStatus(compareStatus, error.message || "Could not compare the ICS files.", true);
      });
    }

    function resetConvertTool(navigateHome) {
      clearTimeout(convertTextTimer);
      state.generatedIcs = "";
      state.generatedName = "sim-timetable.ics";
      sourceInput.value = "";
      simFileInput.value = "";
      downloadButton.disabled = true;
      convertClearButton.disabled = true;
      convertOutput.classList.add("hidden");
      convertOutput.innerHTML = "";
      setStatus(convertStatus, "", false);
      if (navigateHome) {
        setView("home");
      }
    }

    function swapCompareFiles() {
      var previousFirst = compareState.first;

      compareState.first = compareState.second;
      compareState.second = previousFirst;
      compareFileInput1.value = "";
      compareFileInput2.value = "";
      updateCompareFileNote("first");
      updateCompareFileNote("second");
      updateCompareOrderWarning();

      if (compareState.first && compareState.second) {
        handleCompareFiles(compareState.first, compareState.second);
        setStatus(compareStatus, "Swapped ICS 1 and ICS 2.", false);
      } else {
        compareState.diffIcs = "";
        compareState.diffName = "sim-calendar-diff.ics";
        compareDownloadButton.disabled = true;
        compareOutput.innerHTML = renderComparePanel(compareState, null);
        setStatus(compareStatus, "Swapped the loaded files.", false);
      }
    }

    function resetViewerTool(navigateHome) {
      viewerFileInput.value = "";
      viewerClearButton.disabled = true;
      viewerOutput.classList.add("hidden");
      viewerOutput.innerHTML = "";
      setStatus(viewerStatus, "", false);
      if (navigateHome) {
        setView("home");
      }
    }

    function resetCompareTool(navigateHome) {
      compareFileInput1.value = "";
      compareFileInput2.value = "";
      compareState.first = null;
      compareState.second = null;
      compareState.diffIcs = "";
      compareState.diffName = "sim-calendar-diff.ics";
      compareDownloadButton.disabled = true;
      compareClearButton.disabled = true;
      updateCompareFileNote("first");
      updateCompareFileNote("second");
      updateCompareOrderWarning();
      compareMeta.innerHTML = "";
      compareOutput.innerHTML = renderComparePanel(compareState, null);
      setStatus(compareStatus, "", false);
      if (navigateHome) {
        setView("home");
      }
    }

    compareOutput.innerHTML = renderComparePanel(compareState, null);
  }

  function setStatus(node, message, isError) {
    node.textContent = message;
    node.classList.toggle("danger", Boolean(isError));
    node.classList.toggle("success", !isError);
  }

  function setupDropzone(id, onFiles) {
    var zone = document.getElementById(id);
    ["dragenter", "dragover"].forEach(function (type) {
      zone.addEventListener(type, function (event) {
        event.preventDefault();
        zone.classList.add("dragover");
      });
    });
    ["dragleave", "dragend", "drop"].forEach(function (type) {
      zone.addEventListener(type, function (event) {
        event.preventDefault();
        zone.classList.remove("dragover");
      });
    });
    zone.addEventListener("drop", function (event) {
      var files = Array.prototype.slice.call((event.dataTransfer && event.dataTransfer.files) || []);
      onFiles(files);
    });
  }

  function readSingleFile(file, onSuccess, onError) {
    if (!file) {
      onError("No file selected.");
      return;
    }

    readFileAsText(file).then(onSuccess).catch(function (error) {
      onError(error.message || "Could not read the file.");
    });
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("Could not read " + (file && file.name ? file.name : "the file") + "."));
      };
      reader.readAsText(file);
    });
  }

  function downloadText(fileName, content, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (typeof document !== "undefined") {
    bindUi();
  }

  var api = {
    parseSimInput: parseSimInput,
    parseSimHtml: parseSimHtml,
    parseSimText: parseSimText,
    generateIcs: generateIcs,
    parseIcs: parseIcs,
    compareIcs: compareIcs,
    enrichMeetingLabels: enrichMeetingLabels
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (typeof window !== "undefined") {
    window.SimCalendarParse = api;
  }
}());
